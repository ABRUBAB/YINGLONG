// EVM bytecode check: does any reachable instruction use an opcode that a london EVM (FISCO BCOS 3.x
// targets london) does not have? PUSH0 (0x5f, Shanghai), TLOAD/TSTORE/MCOPY (0x5c/0x5d/0x5e, Cancun),
// BLOBHASH/BLOBBASEFEE (0x49/0x4a, Cancun).
//
// Method: one linear sweep from pc 0 that skips PUSH immediates, exactly as the EVM's own JUMPDEST
// analysis does, so instruction boundaries match what the EVM would execute. An instruction is "live"
// from pc 0 and from every JUMPDEST until the next terminating opcode (STOP, JUMP, RETURN, REVERT,
// INVALID, SELFDESTRUCT). Bytes in a dead stretch (for example the constant tables solc appends after
// the final INVALID) can never execute, because jumps may only land on a JUMPDEST. This over-approximates
// reachability, so it never hides a live forbidden opcode.
const FORBIDDEN = new Map([
  [0x5f, "PUSH0"],
  [0x5c, "TLOAD"],
  [0x5d, "TSTORE"],
  [0x5e, "MCOPY"],
  [0x49, "BLOBHASH"],
  [0x4a, "BLOBBASEFEE"],
]);
const TERMINATORS = new Set([0x00, 0x56, 0xf3, 0xfd, 0xfe, 0xff]);
const JUMPDEST = 0x5b;

export function scanLondon(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const code = Buffer.from(h, "hex");
  const forbidden = [];
  let live = true;
  let liveInstructions = 0;
  let deadBytes = 0;
  for (let pc = 0; pc < code.length; pc++) {
    const op = code[pc];
    if (op === JUMPDEST) live = true;
    const width = op >= 0x60 && op <= 0x7f ? op - 0x5f : 0;
    if (live) {
      liveInstructions++;
      if (FORBIDDEN.has(op)) forbidden.push({ pc, op: FORBIDDEN.get(op) });
      if (TERMINATORS.has(op)) live = false;
    } else {
      deadBytes += 1 + width;
    }
    pc += width;
  }
  return { forbidden, count: liveInstructions, deadBytes };
}
