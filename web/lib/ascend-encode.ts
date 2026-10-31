// Calldata for trades on Ascend's pools (PancakeSwap Infinity CL) through Ascend's UniversalRouter.
// Only viem in here, so it can be checked byte for byte against a real Ascend trade (notes/ascend-testnet.md).
import { encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

export type InfiPoolKey = { currency0: Address; currency1: Address; hooks: Address; poolManager: Address; fee: number; parameters: Hex };

/** UniversalRouter command: one Infinity swap (a list of actions run inside one vault lock). */
export const CMD_INFI_SWAP = "0x10" as Hex;
/** Infinity actions: swap exact-in on one CL pool, then pay what we owe, then take what we're owed. */
export const ACT = { CL_SWAP_EXACT_IN_SINGLE: 0x06, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f } as const;
export const MAX_U128 = (1n << 128n) - 1n;

export const UNIVERSAL_ROUTER_ABI = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
  "error ExecutionFailed(uint256 commandIndex, bytes message)",
  "error TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)",
]);

const POOL_KEY = { type: "tuple", components: [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "hooks", type: "address" },
  { name: "poolManager", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "parameters", type: "bytes32" },
] } as const;
const SWAP_SINGLE = [{ type: "tuple", components: [
  { name: "poolKey", ...POOL_KEY },
  { name: "zeroForOne", type: "bool" },
  { name: "amountIn", type: "uint128" },
  { name: "amountOutMinimum", type: "uint128" },
  { name: "hookData", type: "bytes" },
] }] as const;
const CUR_AMT = [{ type: "address" }, { type: "uint256" }] as const;

/**
 * The single input of an INFI_SWAP command: abi.encode(bytes actions, bytes[] params) for
 * swap exact `amountIn` of `tokenIn` → at least `minOut` of the other side, settled from / paid to the sender.
 */
export function swapInput(key: InfiPoolKey, zeroForOne: boolean, amountIn: bigint, minOut: bigint): Hex {
  const tokenIn = zeroForOne ? key.currency0 : key.currency1;
  const tokenOut = zeroForOne ? key.currency1 : key.currency0;
  const actions = `0x${[ACT.CL_SWAP_EXACT_IN_SINGLE, ACT.SETTLE_ALL, ACT.TAKE_ALL].map((a) => a.toString(16).padStart(2, "0")).join("")}` as Hex;
  const params = [
    encodeAbiParameters(SWAP_SINGLE, [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, hookData: "0x" }]),
    encodeAbiParameters(CUR_AMT, [tokenIn, amountIn]),
    encodeAbiParameters(CUR_AMT, [tokenOut, minOut]),
  ];
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, params]);
}

/** Full calldata for UniversalRouter.execute(commands, inputs, deadline). */
export function swapCalldata(key: InfiPoolKey, zeroForOne: boolean, amountIn: bigint, minOut: bigint, deadline: bigint): Hex {
  return encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: "execute", args: [CMD_INFI_SWAP, [swapInput(key, zeroForOne, amountIn, minOut)], deadline] });
}

/** TooLittleReceived(min, received) anywhere in revert data (bare, or wrapped in ExecutionFailed): `received`. */
export const TOO_LITTLE_SELECTOR = "4e86d23a"; // keccak("TooLittleReceived(uint256,uint256)"), checked in the encoding test
export function receivedFromRevert(data: string | null | undefined): bigint | null {
  if (!data) return null;
  const h = data.toLowerCase().replace(/^0x/, "");
  const i = h.indexOf(TOO_LITTLE_SELECTOR);
  if (i < 0 || h.length < i + 8 + 128) return null;
  try { return BigInt(`0x${h.slice(i + 8 + 64, i + 8 + 128)}`); } catch { return null; }
}
