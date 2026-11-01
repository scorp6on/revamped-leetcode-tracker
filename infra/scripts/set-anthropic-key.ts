// Stores your Anthropic API key in Parameter Store (#27). It never goes into code, git or a chat.
//
//   $env:AWS_PROFILE="leettracker"; npm run set-anthropic-key -w infra -- dev
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const stage = process.argv[2];
if (stage !== "dev" && stage !== "prod") {
  console.error("usage: npm run set-anthropic-key -w infra -- <dev|prod>");
  process.exit(1);
}

// Reads a line without echoing it to the terminal.
const promptHidden = (question: string) =>
  new Promise<string>((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
      if (s.startsWith(question)) write.call(rl, question);
    };
    rl.question(question, (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
  });

const main = async () => {
  const key = (await promptHidden(`Anthropic API key for ${stage}: `)).trim();
  if (!key.startsWith("sk-ant-")) throw new Error("that doesn't look like an Anthropic API key");
  const name = `/leetcode-tracker/${stage}/anthropic-api-key`;
  await new SSMClient({}).send(new PutParameterCommand({ Name: name, Value: key, Type: "SecureString", Overwrite: true }));
  console.log(`✔ stored ${name}`);
  console.log("Running Lambdas cache secrets for up to 5 minutes, so a change applies within that time.");
};

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
