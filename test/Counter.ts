import { expect } from "chai";
import { viem } from "hardhat";

describe("Counter (viem + Hardhat)", function () {
  let publicClient: Awaited<ReturnType<typeof viem.getPublicClient>>;

  before(async function () {
    publicClient = await viem.getPublicClient();
  });

  it("emits Increment when calling inc()", async function () {
    const counter = await viem.deployContract("Counter");

    await viem.assertions.emitWithArgs(
      counter.write.inc(),
      counter,
      "Increment",
      [1n],
    );
  });

  it("sum of Increment events equals current value", async function () {
    const counter = await viem.deployContract("Counter");
    const fromBlock = await publicClient.getBlockNumber();

    // run a series of increments
    for (let i = 1n; i <= 10n; i++) {
      await counter.write.incBy([i]);
    }

    const events = await publicClient.getContractEvents({
      address: counter.address,
      abi: counter.abi,
      eventName: "Increment",
      fromBlock,
      strict: true,
    });

    const total = events.reduce((acc, ev) => acc + ev.args.by, 0n);
    expect(await counter.read.x()).to.equal(total);
  });
});
