import { execFileSync } from "node:child_process";
export const project = "c8ed6184-51d0-4e31-bf91-8ecdbd2ecb6c";
export const environment = "bbb54be8-616c-4c1f-a61f-d6679356695c";
export const service = "9369bd2c-5c4a-4a80-b458-a4ca8ccdba61";
export function railway(args, input) {
  // Only trusted argument arrays reach the shell; secrets travel through stdin.
  if (args.some((v) => /[`$\r\n]/.test(v)))
    throw new Error("Invalid CLI argument");
  const command =
    "railway " + args.map((v) => "'" + v.replaceAll("'", "''") + "'").join(" ");
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      RAILWAY_CALLER: "skill:use-railway@1.4.0",
      RAILWAY_AGENT_SESSION: "caju-20260910-foundation",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}
export function variables(target) {
  return JSON.parse(
    railway([
      "variable",
      "list",
      "--project",
      project,
      "--environment",
      environment,
      "--service",
      target,
      "--json",
    ]),
  );
}
export function tunnelUrl(url) {
  const result = new URL(url);
  result.hostname = "127.0.0.1";
  result.port = "15432";
  return result.toString();
}
export function setVariable(key, value) {
  railway(
    [
      "variable",
      "set",
      key,
      "--stdin",
      "--project",
      project,
      "--environment",
      environment,
      "--service",
      service,
      "--skip-deploys",
    ],
    value,
  );
}
