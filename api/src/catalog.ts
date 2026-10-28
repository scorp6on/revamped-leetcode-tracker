import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { buildCatalog, type LeetCodeQuestion } from "./catalog/build";

const PAGE = 100;
const PAUSE_MS = 1000; // about one request a second, to be polite to an unofficial API

const QUERY = `query q($skip: Int, $limit: Int) {
  problemsetQuestionList: questionList(categorySlug: "", limit: $limit, skip: $skip, filters: {}) {
    total: totalNum
    questions: data {
      frontendQuestionId: questionFrontendId
      title
      titleSlug
      difficulty
      acRate
      paidOnly: isPaidOnly
      topicTags { name slug }
    }
  }
}`;

const fetchPage = async (skip: number) => {
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", referer: "https://leetcode.com/problemset/" },
    body: JSON.stringify({ query: QUERY, variables: { skip, limit: PAGE } }),
  });
  if (!res.ok) throw new Error(`LeetCode answered ${res.status} at skip=${skip}`);
  const page = (await res.json())?.data?.problemsetQuestionList;
  if (!page || !Array.isArray(page.questions)) throw new Error(`unexpected response at skip=${skip}`);
  return page as { total: number; questions: LeetCodeQuestion[] };
};

const s3 = new S3Client({});

// Runs weekly and on deploy. Any failure throws before the upload, so the last good catalog stays.
export const handler = async () => {
  const first = await fetchPage(0);
  const questions = [...first.questions];
  for (let skip = PAGE; skip < first.total; skip += PAGE) {
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    questions.push(...(await fetchPage(skip)).questions);
  }

  const catalog = buildCatalog(questions, first.total);
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.SITE_BUCKET,
      Key: "data/catalog.json",
      Body: JSON.stringify(catalog),
      ContentType: "application/json",
      CacheControl: "public, max-age=3600",
    }),
  );
  console.log(`catalog written: ${catalog.problems.length} problems, ${Object.keys(catalog.tags).length} tags`);
  return { problems: catalog.problems.length };
};
