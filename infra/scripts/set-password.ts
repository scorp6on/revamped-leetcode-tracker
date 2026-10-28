// One-time (or password-change) setup: hashes your password locally and stores the hash and a
// JWT signing secret in Parameter Store. The plain password never leaves this machine.
//
//   $env:AWS_PROFILE="leettracker"; npm run set-password -w infra -- dev [--rotate-secret]
import { randomBytes } from "node:crypto";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { GetParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { hashPassword } from "../../api/src/auth/password";

const MIN_LENGTH = 12;

const [stage, ...flags] = process.argv.slice(2);
if (stage !== "dev" && stage !== "prod") {
  console.error("usage: npm run set-password -w infra -- <dev|prod> [--rotate-secret]");
  process.exit(1);
}
const rotateSecret = flags.includes("--rotate-secret");
const prefix = `/leetcode-tracker/${stage}`;
const ssm = new SSMClient({});

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

const exists = async (name: string) => {
  try {
    await ssm.send(new GetParameterCommand({ Name: name }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "ParameterNotFound") return false;
    throw err;
  }
};

const put = (name: string, value: string) =>
  ssm.send(new PutParameterCommand({ Name: name, Value: value, Type: "SecureString", Overwrite: true }));

const main = async () => {
  const password = await promptHidden(`New password for ${stage}: `);
  if (password.length < MIN_LENGTH) throw new Error(`password must be at least ${MIN_LENGTH} characters`);
  if ((await promptHidden("Confirm password: ")) !== password) throw new Error("passwords don't match");

  await put(`${prefix}/password-hash`, await hashPassword(password));
  console.log(`✔ stored ${prefix}/password-hash`);

  const secretName = `${prefix}/jwt-secret`;
  if (rotateSecret || !(await exists(secretName))) {
    await put(secretName, randomBytes(32).toString("base64"));
    console.log(`✔ stored ${secretName}${rotateSecret ? " (rotated: every device is logged out)" : ""}`);
  } else {
    console.log(`• kept existing ${secretName} (pass --rotate-secret to log out every device)`);
  }
  console.log("Running Lambdas cache secrets for up to 5 minutes, so a change applies within that time.");
};

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
