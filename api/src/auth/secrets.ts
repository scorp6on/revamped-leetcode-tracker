import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: string; at: number }>();

// PARAM_PREFIX is e.g. /leetcode-tracker/dev. Values are cached for 5 minutes while the Lambda is
// warm, so a password change takes effect within that window.
export const getSecret = async (name: "password-hash" | "jwt-secret") => {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const { Parameter } = await ssm.send(
    new GetParameterCommand({ Name: `${process.env.PARAM_PREFIX}/${name}`, WithDecryption: true }),
  );
  if (!Parameter?.Value) throw new Error(`secret ${name} is not set`);
  cache.set(name, { value: Parameter.Value, at: Date.now() });
  return Parameter.Value;
};
