"""Minimal JSON-RPC client (standard library only) and contract-call helpers."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any

from eth_abi import decode, encode

from .hexutil import hex_to_bytes, keccak, to_hex


class RpcError(Exception):
    def __init__(self, message: str, code: int | None = None, data: Any = None):
        super().__init__(message)
        self.code = code
        self.data = data


class RpcUnavailable(RpcError):
    pass


class Rpc:
    def __init__(self, url: str, timeout: float = 20.0, retries: int = 2):
        self.url = url
        self.timeout = timeout
        self.retries = retries
        self._id = 0

    def call(self, method: str, params: list | None = None) -> Any:
        self._id += 1
        body = json.dumps({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or []}).encode()
        req = urllib.request.Request(
            self.url, data=body, headers={"content-type": "application/json", "user-agent": "yinglong-verify/0.1"}
        )
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as e:
                last = e
                if e.code in (429, 502, 503, 504) and attempt < self.retries:
                    time.sleep(1.0 + attempt)
                    continue
                try:
                    payload = json.loads(e.read().decode("utf-8"))
                    break
                except Exception:  # noqa: BLE001
                    raise RpcUnavailable(f"{self.url}: HTTP {e.code}") from e
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                last = e
                if attempt < self.retries:
                    time.sleep(0.5 + attempt)
                    continue
                raise RpcUnavailable(f"{self.url} is not reachable ({e})") from e
        else:  # pragma: no cover
            raise RpcUnavailable(f"{self.url}: {last}")
        if "error" in payload and payload["error"]:
            err = payload["error"]
            raise RpcError(str(err.get("message", err)), err.get("code"), err.get("data"))
        return payload.get("result")

    # ---------------------------------------------------------------- helpers

    def chain_id(self) -> int:
        return int(self.call("eth_chainId"), 16)

    def block_number(self) -> int:
        return int(self.call("eth_blockNumber"), 16)

    def get_block(self, number: int | str) -> dict:
        tag = hex(number) if isinstance(number, int) else number
        return self.call("eth_getBlockByNumber", [tag, False])

    def get_code(self, address: str, block: str = "latest") -> bytes:
        return hex_to_bytes(self.call("eth_getCode", [address, block]) or "0x")

    def code_hash(self, address: str) -> str:
        return to_hex(keccak(self.get_code(address)))

    def eth_call(self, to: str, data: bytes | str, block: str | int = "latest", sender: str | None = None, value: int = 0, gas: int | None = None) -> bytes:
        tx: dict[str, Any] = {"to": to, "data": data if isinstance(data, str) else to_hex(data)}
        if sender:
            tx["from"] = sender
        if value:
            tx["value"] = hex(value)
        if gas:
            tx["gas"] = hex(gas)
        tag = hex(block) if isinstance(block, int) else block
        return hex_to_bytes(self.call("eth_call", [tx, tag]) or "0x")

    def call_fn(self, to: str, signature: str, arg_types: list[str], args: list, out_types: list[str], block: str | int = "latest") -> tuple:
        """Call a view function given its canonical signature, e.g. "isLive(bytes32)"."""
        data = keccak(signature.encode())[:4] + encode(arg_types, args)
        return decode(out_types, self.eth_call(to, data, block))

    def get_logs(self, address: str, topics: list, from_block: int, to_block: int | str = "latest") -> list[dict]:
        tb = hex(to_block) if isinstance(to_block, int) else to_block
        return self.call("eth_getLogs", [{"address": address, "topics": topics, "fromBlock": hex(from_block), "toBlock": tb}])


def selector(signature: str) -> bytes:
    return keccak(signature.encode())[:4]


def extract_revert_data(err: RpcError) -> str | None:
    """Pull revert bytes out of a JSON-RPC error (anvil, geth, reth, FISCO and most providers)."""
    d = err.data
    for _ in range(4):
        if isinstance(d, str) and d.startswith("0x"):
            return d
        if isinstance(d, dict):
            d = d.get("data") or d.get("result") or d.get("output")
            continue
        break
    msg = str(err)
    if "0x" in msg:
        cand = msg[msg.index("0x") :].split()[0].rstrip(".,;\"')")
        if len(cand) >= 10 and all(c in "0123456789abcdefABCDEF" for c in cand[2:]):
            return cand
    return None
