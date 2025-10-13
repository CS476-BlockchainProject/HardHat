#!/usr/bin/env ts-node
import main from "./cli-main";

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
