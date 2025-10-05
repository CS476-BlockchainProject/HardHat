// Ensure Hardhat config & plugins are loaded when running with node:test
import "hardhat/register";

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { network } from "hardhat";

describe("Counter", () => {
  let viem: Awaited<ReturnType<typeof network.connect>>["viem"];
  let publicClient: Awaited<ReturnType<NonNullable<typeof viem>["getPublicClient"]>>;

  // Connect once for the suite
  before(async () => {
    const conn = await network.connect();
    viem = conn.viem;
    publicClient = await viem.getPublicClient();
  });

  it("Should emit the Increment event when calling inc()", async () => {
    const counter = await viem.deployContract("Counter");

    await viem.assertions.emitWithArgs(
      counter.write.inc(),
      counter,
      "Increment",
      [1n],
    );
  });

  it("The sum of Increment events should match the current value", async () => {
    const counter = await viem.deployContract("Counter");
    const deploymentBlockNumber = await publicClient.getBlockNumber();

    // run a series of increments
    for (let i = 1n; i <= 10n; i++) {
      await counter.write.incBy([i]);
    }

    const events = await publicClient.getContractEvents({
      address: counter.address,
      abi: counter.abi,
      eventName: "Increment",
      fromBlock: deploymentBlockNumber,
      strict: true,
    });

    // aggregated events should equal current state
    let total = 0n;
    for (const ev of events) total += ev.args.by;

    assert.equal(total, await counter.read.x());
  });
});
