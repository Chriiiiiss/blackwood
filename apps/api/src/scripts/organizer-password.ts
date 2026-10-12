import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { hashPassword } from "../modules/organizer/password.ts";

async function main() {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    process.argv.length !== 2
  ) {
    throw new Error(
      "Run interactively without arguments. Never pass a password on the command line.",
    );
  }
  const hiddenOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const reader = createInterface({
    input: process.stdin,
    output: hiddenOutput,
    terminal: true,
  });
  const abort = new AbortController();
  reader.on("SIGINT", () => abort.abort());
  try {
    process.stdout.write("Password (20–128 characters; input hidden): ");
    const password = await reader.question("", { signal: abort.signal });
    process.stdout.write("\nConfirm password (input hidden): ");
    const confirmation = await reader.question("", { signal: abort.signal });
    process.stdout.write("\n");
    if (password !== confirmation) throw new Error("Passwords do not match.");
    const hash = await hashPassword(password);
    const file = await open(
      new URL("../../../../.organizer-password.env", import.meta.url),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.chmod(0o600);
      await file.writeFile(`ORGANIZER_PASSWORD_HASH='${hash}'\n`);
    } finally {
      await file.close();
    }
    process.stdout.write(
      "Hash saved to .organizer-password.env (0600). Copy its quoted assignment into the private backend env file, then restart the API.\n",
    );
  } finally {
    reader.close();
    hiddenOutput.destroy();
  }
}

main().catch(() => {
  process.stderr.write(
    "Password setup failed or was cancelled. Use matching passwords of 20–128 characters (512 UTF-8 bytes maximum) in an interactive terminal.\n",
  );
  process.exitCode = 1;
});
