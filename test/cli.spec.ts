import { describe, it, vi, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";

const spawnMock = vi.fn(() => {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => child.emit("close", 0));
  return child;
});
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

function mockReadlineWithAnswers(answers: string[]) {
  const queue = [...answers];

  const createInterface = vi.fn(() => {
    const rl = {
      question: (prompt: string, cb: (err: any, answer?: string) => void) => {
        const next = queue.length ? queue.shift()! : "";
        setImmediate(() => cb(null, next));
      },
      close: vi.fn(),
    };
    return rl;
  });

  vi.doMock("node:readline", () => ({
    default: { createInterface },
    createInterface,
  }));

  return { createInterface };
}

function resetEnv() {
  process.env.NETWORK = "hardhat";
  delete process.env.ACTION;
  delete process.env.TO;
  delete process.env.TRANSFER_AMOUNT;
  delete process.env.SPENDER;
  delete process.env.APPROVE_AMOUNT;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resetEnv();
});

// --- tests ---
const expectedDeployPath = path.resolve(process.cwd(), "scripts/deploy2.ts");
describe("Hardhat Minimal Client CLI", () => {
  it("option [1] runs scripts/deploy2.ts via Hardhat", async () => {
    mockReadlineWithAnswers(["1", "q"]);
    const { main } = await import("../scripts/cli-main");   // <— no .ts
    await main();

    const call = spawnMock.mock.calls.find((c) => String(c[1]).includes("deploy2.ts"));
    expect(call).toBeTruthy();
    const [cmd, args, opts] = call!;
    expect(cmd).toBe("npx");
    expect(args).toEqual(
      expect.arrayContaining([
        "hardhat",
        "run",
         expectedDeployPath,
        "--network",
        "hardhat",
      ])
    );
    expect(opts).toMatchObject({
      shell: true,
      env: expect.objectContaining({ NETWORK: "hardhat" }),
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("option [2] runs transfer-approve2.ts with ACTION=transfer and passed TO/TRANSFER_AMOUNT", async () => {
    mockReadlineWithAnswers([
      "2",
      "0x1111222233334444555566667777888899990000",
      "12345",
      "q",
    ]);
    const { main } = await import("../scripts/cli-main");
    await main();

    const expectedTransferPath = path.resolve(process.cwd(), "scripts/transfer-approve2.ts");
    const call = spawnMock.mock.calls.find((c) => String(c[1]).includes("transfer-approve2.ts"));
    expect(call).toBeTruthy();
    const [cmd, args, opts] = call!;
    expect(cmd).toBe("npx");
    expect(args).toEqual(
      expect.arrayContaining([
        "hardhat",
        "run",
        expectedTransferPath,
        "--network",
        "hardhat",
      ])
    );
    expect(opts?.env).toEqual(
      expect.objectContaining({
        ACTION: "transfer",
        TO: "0x1111222233334444555566667777888899990000",
        TRANSFER_AMOUNT: "12345",
      })
    );
  });
});
