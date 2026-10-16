#!/usr/bin/env python3
"""Build the contract-analysis evidence JSON in contracts/reports/ from raw tool output.

Every number in the output files is read from a raw tool artifact kept next to them; the only hand-written
content is the Slither and Aderyn triage below (verdict and one-line reason per finding), which carries no
numbers other than the source locations the tools reported.

Usage (run from contracts/, tools on PATH):
    python reports/gen_reports.py slither    # reads reports/slither.raw.json
    python reports/gen_reports.py aderyn     # reads reports/aderyn.raw.json if present, else records "not run"
    python reports/gen_reports.py coverage   # reads reports/lcov.info and reports/coverage.summary.txt
    python reports/gen_reports.py gas        # reads reports/gas.raw.json (forge test --json of GasOverhead.t.sol)
    python reports/gen_reports.py symbolic   # reads reports/halmos.raw.json and reports/halmos.log.txt
    python reports/gen_reports.py fuzz       # reads reports/forge-test.raw.json (forge test --json, full suite)
    python reports/gen_reports.py versions   # tool versions actually installed
    python reports/gen_reports.py all
"""
import datetime
import json
import math
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACTS = os.path.dirname(HERE)


def _run(cmd, cwd=CONTRACTS):
    try:
        out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=600)
        return (out.stdout or "") + (out.stderr or "")
    except Exception as exc:  # tool missing or failing: record it, never guess
        return f"unavailable: {exc}"


def _git(*args):
    return _run(["git", *args]).strip()


def _tool_version(name):
    exe = shutil.which(name)
    if not exe:
        return "not found on PATH"
    first = _run([exe, "--version"]).strip().splitlines()
    return first[0].strip() if first else "unknown"


def header(tool, version, command):
    status = _git("status", "--porcelain", "--", ".")
    return {
        "tool": tool,
        "version": version,
        "command": command,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commit": _git("rev-parse", "HEAD"),
        # git tree hash of contracts/src at that commit: identical across commits that did not touch src
        "srcTree": _git("rev-parse", "HEAD:contracts/src"),
        "srcHasUncommittedChanges": bool(_git("status", "--porcelain", "--", "src")),
        "uncommittedPathsUnderContracts": [ln[3:] for ln in status.splitlines() if ln.strip()],
    }


def write(name, obj):
    path = os.path.join(HERE, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=2, ensure_ascii=True)
        f.write("\n")
    print(f"wrote reports/{name}")


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return json.load(f)


def median(xs):
    s = sorted(xs)
    n = len(s)
    if n == 0:
        return None
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) // 2


def p95(xs):
    """Nearest-rank 95th percentile."""
    s = sorted(xs)
    if not s:
        return None
    return s[max(0, math.ceil(0.95 * len(s)) - 1)]


# ------------------------------------------------------------------------------------------------- Slither

SLITHER_TRIAGE = {
    # id: (verdict, reason grounded in the code)
    "8ee0cae62fa545e4c15dd6148a4aafcb265c4fa6d32201bea46f68436001402b": (
        "false positive",
        "Strict equality is on the Status enum of a stored mandate, which only the account's own publish/supersede/revoke "
        "writes; the detector targets attacker-influenced values such as balances, none is involved.",
    ),
    "d46620cbb74d7e733911a26e17f90cea9a16e22dc3910a30588d9ca08c94b5d6": (
        "false positive",
        "latestRoot() is a view that tests whether the batch array is empty; array length is not attacker-manipulable "
        "in the way the detector (balance/ether equality) assumes.",
    ),
    "07bc7859e41833dd51bcda5388f3c40da6e83fc31a24da11c3d1e3f57d44138f": (
        "false positive",
        "allowed_ is meant to start false and is set true only when the asset is found in the sealed list; the "
        "default is the fail-closed value.",
    ),
    "81aabbeba7e54ea00a05014be3acc987de2e3092b676384abb4a0c0c61159358": (
        "false positive",
        "found_ starts false and is set only when the category is in the sealed list; if it stays false the hook "
        "reverts with CategoryBudgetExceeded (fail closed).",
    ),
    "e008bd2205700b389c763ffe444155a59293ec57f3f64b92323e35aeb4c514ca": (
        "false positive",
        "cap_ is read only after found_ is true, and it is assigned in the same branch that sets found_.",
    ),
    "83ee39c9debd1ab4ed011e6890d50f973ae183de5b04512a16b9f292457816b7": (
        "false positive",
        "receiptNonce_ defaults to zero when the optional args are empty; it is only emitted in an event, never used "
        "for a decision.",
    ),
    "db462635fbddadf78a1283c1c28b8bda7d8112992ca113e94a072151d150c512": (
        "false positive",
        "intentHash_ defaults to zero when the optional args are empty; it is only emitted in an event, never used for "
        "a decision.",
    ),
    "59527cc6f3ab5f607ac311ad14c2fe0c696e6e9ae3ab866df2ed13c4d03cd39b": (
        "false positive",
        "Only the local agent id is needed to decide whether the beneficiary is an agent; status and DID are "
        "deliberately ignored here (VerifiedPayeeEnforcer governs who may be paid).",
    ),
    "807e40d17ebab269bbaad972daeeb3d42c5b8b8a0fa56e3b6651dc838a8f6f2c": (
        "false positive",
        "Payee verification needs only the active flag; the category is consumed by the budget and co-sign enforcers.",
    ),
    "9ca634e69288c3b248fc15c7bc6e8511b5403c1d894b709f0f13119b04d3275a": (
        "false positive",
        "Both the recovered signer and the RecoverError are checked; the ignored third value is only the error "
        "argument used for revert data.",
    ),
    "9f321498e0d949dea70bbf08d026584a16558e4b7a3702a6d24adcf0476343d6": (
        "false positive",
        "Only call type and exec type decide single/default mode; mode selector and payload are not interpreted by the "
        "framework's DeleGatorCore for single default executions.",
    ),
    "a2164f5443fb2f8190c6f4ae6ed089db148339335e32fba9a2e31f332bbafc62": (
        "false positive",
        "The pause check needs agent id and status only; the owner DID is checked by AgentLineageEnforcer.",
    ),
    "deae0d490c6388ad47494993d931171a50772be1f9f5524c00111b8bcf883e0d": (
        "false positive",
        "The forbidden-target rule concerns only the call target; value and calldata are governed by ValueLte and "
        "AllowedMethods and the payment enforcers.",
    ),
    "f0af46df4c7b6c370fef0decf2612f63fb82cae0a351f0ed2a13eba1bafb0d03": (
        "false positive",
        "Same pattern as YinglongEnforcer._requireSingleDefault: only call type and exec type are relevant.",
    ),
}


def _location(result):
    for el in result.get("elements", []):
        sm = el.get("source_mapping") or {}
        if el.get("type") == "node" and sm.get("lines"):
            return f"{sm['filename_relative']}#L{sm['lines'][0]}"
    for el in result.get("elements", []):
        sm = el.get("source_mapping") or {}
        if sm.get("lines"):
            return f"{sm['filename_relative']}#L{sm['lines'][0]}"
    return "unknown"


def gen_slither():
    raw = load("slither.raw.json")
    dets = raw["results"]["detectors"]
    impacts = ["High", "Medium", "Low", "Informational", "Optimization"]
    counts = {k: sum(1 for d in dets if d["impact"] == k) for k in impacts}
    by_check = {}
    for d in dets:
        by_check.setdefault(d["impact"], {}).setdefault(d["check"], 0)
        by_check[d["impact"]][d["check"]] += 1
    triage, true_pos = [], []
    for d in dets:
        if d["impact"] not in ("High", "Medium"):
            continue
        verdict, reason = SLITHER_TRIAGE.get(d["id"], ("untriaged", "new finding: not yet reviewed"))
        item = {
            "id": d["id"],
            "impact": d["impact"],
            "confidence": d["confidence"],
            "detector": d["check"],
            "location": _location(d),
            "description": d["description"].strip().splitlines()[0],
            "verdict": verdict,
            "reason": reason,
        }
        triage.append(item)
        if verdict == "true positive":
            true_pos.append(item)
    open_high = sum(1 for t in triage if t["impact"] == "High" and t["verdict"] != "false positive")
    open_med = sum(1 for t in triage if t["impact"] == "Medium" and t["verdict"] != "false positive")
    out = header(
        "slither",
        _tool_version("slither"),
        'slither . --filter-paths "lib/|test/|script/" --json reports/slither.raw.json   (cwd: contracts/)',
    )
    out.update(
        {
            "scope": "contracts/src (lib/, test/ and script/ filtered out)",
            "success": raw.get("success"),
            "detectorsRun": None,
            "rawCountsByImpact": counts,
            "rawCountsByImpactAndDetector": by_check,
            "openAfterTriage": {"High": open_high, "Medium": open_med},
            "triage": triage,
            "truePositives": true_pos,
            "lowAndInformationalNote": "Low, Informational and Optimization findings are counted but not triaged here.",
        }
    )
    log = os.path.join(HERE, "slither.log.txt")
    if os.path.exists(log):
        m = re.search(r"analyzed \((\d+) contracts with (\d+) detectors\), (\d+) result", open(log, encoding="utf-8").read())
        if m:
            out["detectorsRun"] = int(m.group(2))
            out["contractsAnalyzed"] = int(m.group(1))
    write("slither.json", out)


# ------------------------------------------------------------------------------------------------- Aderyn


ADERYN_TRIAGE = {
    # "detector|path#Lline": (verdict, reason grounded in the code)
    "eth-send-unchecked-address|src/rails/ProtectedPayment.sol#L97": (
        "false positive",
        "refund() moves no ETH; it returns the escrowed ERC-20 to the payer recorded at creation (never to msg.sender), "
        "only after refundAfter and once (Held -> Refunded, nonReentrant).",
    ),
    "eth-send-unchecked-address|src/rails/SignedQuoteSettlement.sol#L54": (
        "false positive",
        "depositLiquidity() moves no ETH; it pulls the caller's own ERC-20 and credits the caller's liquidity.",
    ),
    "eth-send-unchecked-address|src/rails/SignedQuoteSettlement.sol#L60": (
        "false positive",
        "withdrawLiquidity() moves no ETH; it pays ERC-20 only to msg.sender, bounded by msg.sender's own credited "
        "liquidity (checked subtraction reverts first).",
    ),
    "reentrancy-state-change|src/enforcers/CategoryBudgetEnforcer.sol#L89": (
        "false positive",
        "IPayeeBookView.lookup is declared view, so it is a STATICCALL: the callee cannot change state or re-enter a "
        "state-changing path; the spent counter is keyed by msg.sender (the DelegationManager).",
    ),
}


def gen_aderyn():
    attempts_path = os.path.join(HERE, "aderyn.attempts.json")
    attempts = json.load(open(attempts_path, encoding="utf-8")) if os.path.exists(attempts_path) else []
    raw_path = os.path.join(HERE, "aderyn.raw.json")
    command = "aderyn . --src src -x lib,test,script -o reports/aderyn.raw.json   (cwd: contracts/)"
    if not os.path.exists(raw_path):
        out = header("aderyn", "not installed", command)
        out.update(
            {
                "status": "not run",
                "reason": "No Aderyn binary could be installed on this Windows host (attempts below); no result is claimed.",
                "attempts": attempts,
            }
        )
        write("aderyn.json", out)
        return
    raw = load("aderyn.raw.json")

    def issues(sev):
        res = []
        for i in raw.get(f"{sev}_issues", {}).get("issues", []):
            res.append(
                {
                    "detector": i.get("detector_name"),
                    "title": i.get("title"),
                    "instances": [
                        f"{x.get('contract_path', '').replace(chr(92), '/')}#L{x.get('line_no')}" for x in i.get("instances", [])
                    ],
                }
            )
        return res

    high, low = issues("high"), issues("low")
    triage, true_pos = [], []
    for i in high:
        for loc in i["instances"]:
            verdict, reason = ADERYN_TRIAGE.get(f"{i['detector']}|{loc}", ("untriaged", "new finding: not yet reviewed"))
            item = {"detector": i["detector"], "title": i["title"], "location": loc, "verdict": verdict, "reason": reason}
            triage.append(item)
            if verdict == "true positive":
                true_pos.append(item)
    version = _tool_version("aderyn")
    patch = os.path.join(HERE, "aderyn-windows.patch")
    if os.path.exists(patch):
        version += " (built from the v0.6.8 source release with the local Windows portability patch reports/aderyn-windows.patch)"
    out = header("aderyn", version, command)
    out.update(
        {
            "status": "run",
            "scope": "contracts/src (lib, test and script excluded)",
            "filesSummary": raw.get("files_summary"),
            "detectorsUsed": len(raw.get("detectors_used", [])),
            "rawCounts": {
                "High": raw.get("issue_count", {}).get("high"),
                "Low": raw.get("issue_count", {}).get("low"),
                "HighInstances": sum(len(i["instances"]) for i in high),
                "LowInstances": sum(len(i["instances"]) for i in low),
            },
            "openAfterTriage": {"HighInstances": sum(1 for t in triage if t["verdict"] != "false positive")},
            "triage": triage,
            "truePositives": true_pos,
            "lowByDetector": {i["detector"]: len(i["instances"]) for i in low},
            "lowNote": "Aderyn has no Medium level; Low findings are counted, not triaged.",
            "attempts": attempts,
        }
    )
    write("aderyn.json", out)


# ------------------------------------------------------------------------------------------------- coverage


def _parse_lcov(path):
    files, cur = {}, None
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line.startswith("SF:"):
            cur = line[3:].replace("\\", "/")
            files[cur] = {"LF": 0, "LH": 0, "BRF": 0, "BRH": 0, "FNF": 0, "FNH": 0}
        elif cur and ":" in line and line.split(":", 1)[0] in files[cur]:
            k, v = line.split(":", 1)
            files[cur][k] = int(v)
        elif line == "end_of_record":
            cur = None
    return files


def _pct(h, f):
    return None if f == 0 else round(100.0 * h / f, 2)


def gen_coverage():
    lcov = _parse_lcov(os.path.join(HERE, "lcov.info"))
    summary_txt = open(os.path.join(HERE, "coverage.summary.txt"), encoding="utf-8").read()
    stmts = {}
    cell = r"\s*(?:[\d.]+%|N/A)\s*\((\d+)/(\d+)\)\s*\|"
    row = re.compile(r"^\|\s*(\S+)\s*\|" + cell * 4)
    for line in summary_txt.splitlines():
        m = row.match(line.strip())
        if m:
            stmts[m.group(1).replace("\\", "/")] = (int(m.group(4)), int(m.group(5)))
    per_file, tot = {}, {"LF": 0, "LH": 0, "BRF": 0, "BRH": 0, "FNF": 0, "FNH": 0, "SF": 0, "SH": 0}
    for f, c in sorted(lcov.items()):
        if not f.startswith("src/"):
            continue
        sh, sf = stmts.get(f, (0, 0))
        per_file[f] = {
            "lines": {"hit": c["LH"], "found": c["LF"], "pct": _pct(c["LH"], c["LF"])},
            "statements": {"hit": sh, "found": sf, "pct": _pct(sh, sf)},
            "branches": {"hit": c["BRH"], "found": c["BRF"], "pct": _pct(c["BRH"], c["BRF"])},
            "functions": {"hit": c["FNH"], "found": c["FNF"], "pct": _pct(c["FNH"], c["FNF"])},
        }
        for k in ("LF", "LH", "BRF", "BRH", "FNF", "FNH"):
            tot[k] += c[k]
        tot["SH"] += sh
        tot["SF"] += sf
    cmd_path = os.path.join(HERE, "coverage.command.txt")
    command = open(cmd_path, encoding="utf-8").read().strip() if os.path.exists(cmd_path) else "forge coverage"
    out = header("forge coverage", _tool_version("forge"), command)
    out.update(
        {
            "scope": "contracts/src only (rows for test/, script/ and lib/ dropped from the same run)",
            "total": {
                "lines": {"hit": tot["LH"], "found": tot["LF"], "pct": _pct(tot["LH"], tot["LF"])},
                "statements": {"hit": tot["SH"], "found": tot["SF"], "pct": _pct(tot["SH"], tot["SF"])},
                "branches": {"hit": tot["BRH"], "found": tot["BRF"], "pct": _pct(tot["BRH"], tot["BRF"])},
                "functions": {"hit": tot["FNH"], "found": tot["FNF"], "pct": _pct(tot["FNH"], tot["FNF"])},
            },
            "perFile": per_file,
            "lcov": "contracts/reports/lcov.info",
            "note": "forge coverage compiles without the optimizer; percentages are over instrumented items only.",
        }
    )
    write("coverage.json", out)


# ------------------------------------------------------------------------------------------------- gas


def _iter_tests(raw):
    for suite, body in raw.items():
        for name, res in body.get("test_results", {}).items():
            yield suite, name, res


def _stats(xs):
    return {"n": len(xs), "median": median(xs), "p95": p95(xs), "min": min(xs) if xs else None, "max": max(xs) if xs else None}


def gen_gas():
    raw = load("gas.raw.json")
    samples = {}  # test -> cadence -> config -> list of (i, gas, calldata)
    status = {}
    for _suite, name, res in _iter_tests(raw):
        status[name] = res.get("status")
        for line in res.get("decoded_logs", []) or []:
            parts = line.strip().split("|")
            if len(parts) == 6 and parts[0] == "GAS":
                _, cad, cfg, i, g, cd = parts
                samples.setdefault(name, {}).setdefault(cad, {}).setdefault(cfg, []).append((int(i), int(g), int(cd)))
    scenarios = {}
    for test, cads in samples.items():
        if not test.startswith("test_gasOverhead_fullVsStock"):
            continue
        for cad, cfgs in cads.items():
            full = sorted(cfgs["full"])
            stock = sorted(cfgs["stock"])
            paired = [f[1] - s[1] for f, s in zip(full, stock)]
            scenarios[cad] = {
                "test": test,
                "full": _stats([x[1] for x in full]),
                "stock": _stats([x[1] for x in stock]),
                "calldataGas": {"full": median([x[2] for x in full]), "stock": median([x[2] for x in stock])},
                "overheadPaired": _stats(paired),
                "overheadOfMedians": median([x[1] for x in full]) - median([x[1] for x in stock]),
            }
    marginal = {}
    mt = samples.get("test_gasMarginal_perCaveat()", {}).get("daily", {})
    if mt:
        full = sorted(mt["full"])
        for cfg, xs in mt.items():
            if not cfg.startswith("without:"):
                continue
            xs = sorted(xs)
            diffs = [f[1] - x[1] for f, x in zip(full, xs)]
            marginal[cfg[len("without:"):]] = {
                "n": len(diffs),
                "medianPaired": median(diffs),
                "p95Paired": p95(diffs),
                "calldataGasMedian": median([f[2] for f in full]) - median([x[2] for x in xs]),
            }
    headline = scenarios.get("daily", {})
    out = header(
        "forge test (gasleft deltas)",
        _tool_version("forge"),
        "forge test --match-path test/GasOverhead.t.sol --json -vv > reports/gas.raw.json   (cwd: contracts/)",
    )
    out.update(
        {
            "testStatus": status,
            "isolate": "effective config has isolate = true (forge config --json), so every top-level call is its own "
            "transaction: each sample includes the 21000 base cost and calldata cost, with cold storage",
            "payment": "1 tHKD ERC-20 transfer to a verified payee (food category) by the agent, via DelegationManager.redeemDelegations",
            "configs": {
                "full": "Nadia's sealed mandate from YinglongBase._nadiaCaveats: 15 caveats = 3 stock (AllowedTargets, "
                "AllowedMethods, ValueLte) + 12 YINGLONG",
                "stock": "4 stock caveats: AllowedTargets, AllowedMethods, ValueLte, ERC20TransferAmount",
            },
            "cadences": {
                "daily": "one day between samples: every full-mandate redemption opens a new VelocityEnforcer window",
                "intraday": "90 minutes between samples (full mandate pays every 3 hours, 8 per day)",
            },
            "headline": {
                "metric": "median of per-payment (full - stock) gas, daily cadence",
                "median": headline.get("overheadPaired", {}).get("median"),
                "p95": headline.get("overheadPaired", {}).get("p95"),
                "n": headline.get("overheadPaired", {}).get("n"),
            },
            "scenarios": scenarios,
            "marginalPerCaveat": {
                "method": "full mandate minus one YINGLONG caveat, paired by sample index, daily cadence; "
                "includes that caveat's calldata, hook dispatch and hook execution",
                "results": marginal,
                "sumOfMedians": sum(v["medianPaired"] for v in marginal.values()) if marginal else None,
            },
            "percentile": "p95 is nearest-rank",
            "rawFileNote": "reports/gas.raw.json keeps decoded_logs; the raw event logs and traces fields were removed to keep it small",
        }
    )
    write("gas.json", out)


# ------------------------------------------------------------------------------------------------- symbolic

SYMBOLIC_MAP = [
    (1, "No redemption sequence exceeds any category cap in any period", "SymCategoryBudget", "check_categoryCapsHold",
     "CategoryBudgetEnforcer.beforeHook x3: symbolic recipients (PayeeBook categories RENT/FOOD/TUITION/unlisted), "
     "symbolic uint256 amounts, symbolic start time and two symbolic uint32 time steps; ghost sum per (category, period)"),
    (2, "The reserve floor is never breached", "SymReserveFloor", "check_reserveFloorHolds",
     "ReserveFloorEnforcer.afterAllHook after a TestUnits transfer: symbolic start balance, amount and floor; "
     "asserts the hook passes exactly when the final balance is at least the floor"),
    (2, "Only single-call default-mode executions are accepted (precondition of the floor check)", "SymReserveFloor",
     "check_onlySingleDefaultMode", "ReserveFloorEnforcer.beforeHook with a fully symbolic bytes32 ModeCode"),
    (3, "A paused account moves nothing", "SymGlobalPause", "check_pausedAccountRefused",
     "GlobalPauseEnforcer.beforeAllHook with the real KillSwitchRegistry: symbolic subset of {self trip, guardian trip, "
     "supervisor halt, dead-man timer with symbolic interval, agent untrip, account untrip}, symbolic elapsed time, "
     "symbolic passport agent id and status"),
    (4, "Only verified payees receive funds", "SymVerifiedPayee", "check_onlyVerifiedPayees",
     "VerifiedPayeeEnforcer.beforeHook with the real PayeeBook: symbolic payment shape (transfer, transferAndCall with "
     "and without beneficiary word, instruct), symbolic recipient, amount and beneficiary word, optional payee removal"),
    (5, "No redemption reaches the account, the DelegationManager or a protected registry", "SymForbiddenTargets",
     "check_forbiddenTargetsUnreachable",
     "ForbiddenTargetsEnforcer.beforeHook: symbolic target, delegator, 4 symbolic forbidden addresses, selector and argument"),
]
VACUITY = {
    "check_vacuity_budgetPaymentCanPass": 1,
    "check_vacuity_floorCanPass": 2,
    "check_vacuity_unpausedCanPass": 3,
    "check_vacuity_payeeCanPass": 4,
    "check_vacuity_targetCanPass": 5,
}


def _halmos_results(raw):
    res = {}
    for key, tests in raw.get("test_results", {}).items():
        contract = key.split(":")[-1]
        for t in tests:
            fname = t["name"].split("(")[0]
            res[(contract, fname)] = t
    return res


def _halmos_status(t):
    code = t.get("exitcode")
    models = t.get("num_models") or 0
    if code == 0 and not models:
        return "proved within bounds"
    if models:
        return "counterexample"
    if code == 2:
        return "timeout"
    return f"error (exitcode {code})"


def _flag(command, name):
    m = re.search(re.escape(name) + r"\s+(\d+)", command)
    return int(m.group(1)) if m else None


def gen_symbolic():
    raw = load("halmos.raw.json")
    res = _halmos_results(raw)
    cmd_path = os.path.join(HERE, "halmos.command.txt")
    command = open(cmd_path, encoding="utf-8").read().strip() if os.path.exists(cmd_path) else "halmos"
    props = []
    for inv, desc, contract, fn, inputs in SYMBOLIC_MAP:
        t = res.get((contract, fn))
        if t is None:
            props.append({"invariant": inv, "property": desc, "check": f"{contract}.{fn}", "status": "not run"})
            continue
        np_ = t.get("num_paths") or [None, None, None]
        tm_ = t.get("time") or [None, None, None]
        paths = {"all": np_[0], "normal": np_[1], "stuck": np_[2]}
        times = {"total": round(tm_[0], 2) if tm_[0] is not None else None,
                 "paths": round(tm_[1], 2) if tm_[1] is not None else None,
                 "models": round(tm_[2], 2) if tm_[2] is not None else None}
        props.append(
            {
                "invariant": inv,
                "property": desc,
                "check": f"{contract}.{fn}",
                "status": _halmos_status(t),
                "symbolicInputs": inputs,
                "paths": paths,
                "timeSeconds": times,
                "boundedLoops": t.get("num_bounded_loops"),
                "counterexamples": t.get("models"),
            }
        )
    vac = []
    for fn, inv in VACUITY.items():
        hit = [t for (c, f), t in res.items() if f == fn]
        if not hit:
            vac.append({"invariant": inv, "probe": fn, "status": "not run"})
            continue
        t = hit[0]
        st = _halmos_status(t)
        vac.append(
            {
                "invariant": inv,
                "probe": fn,
                "expected": "counterexample (shows the hook can pass, so the property check is not vacuous)",
                "status": st,
                "nonVacuous": st == "counterexample",
                "counterexamples": t.get("models"),
            }
        )
    out = header("halmos", _tool_version("halmos"), command)
    out.update(
        {
            "scope": "Our enforcers' hook logic called directly (this test contract plays the DelegationManager), with "
            "the real PayeeBook, KillSwitchRegistry and TestUnits; the DelegationManager, the smart account, signature "
            "verification and the passport registry (mocked) are NOT symbolically executed",
            "claim": "bounded: a property marked 'proved within bounds' has no counterexample over all symbolic inputs "
            "listed, with loops unrolled to the bound below; this is not a full proof of the invariant",
            "bounds": {
                "loop": _flag(command, "--loop"),
                "solverTimeoutAssertionMs": _flag(command, "--solver-timeout-assertion"),
                "depth": "halmos default (0 = unlimited path length)",
                "width": "halmos default (0 = unlimited number of paths)",
                "dynamicLengths": "all byte strings are built inside the checks with fixed lengths",
            },
            "properties": props,
            "vacuityProbes": vac,
            "summary": {
                "provedWithinBounds": sum(1 for p in props if p.get("status") == "proved within bounds"),
                "total": len(props),
                "invariantsCovered": sorted({p["invariant"] for p in props if p.get("status") == "proved within bounds"}),
            },
            "fieldNotes": "paths = halmos num_paths (all, normal, stuck); timeSeconds = halmos time (total, paths, "
            "models), wall clock on the machine that ran it",
            "kontrol": "not run",
        }
    )
    write("symbolic.json", out)


# ------------------------------------------------------------------------------------------------- fuzz


def gen_fuzz():
    raw = load("forge-test.raw.json")
    cfg = json.loads(_run([shutil.which("forge") or "forge", "config", "--json"]))
    inv_calls = inv_reverts = inv_runs = fuzz_runs = 0
    n = {"unit": 0, "fuzz": 0, "invariant": 0}
    failed = []
    per_campaign = []
    for suite, name, res in _iter_tests(raw):
        kind = res.get("kind", {})
        if res.get("status") != "Success":
            failed.append(f"{suite}::{name}")
        if "Invariant" in kind:
            k = kind["Invariant"]
            preds = res.get("invariant_predicate_results") or [{"name": name.split("(")[0], "status": res.get("status")}]
            n["invariant"] += len(preds)
            inv_calls += k.get("calls", 0)
            inv_reverts += k.get("reverts", 0)
            inv_runs += k.get("runs", 0)
            per_campaign.append({"test": f"{suite}::{name}", "kind": "invariant campaign", "runs": k.get("runs"),
                                 "calls": k.get("calls"), "reverts": k.get("reverts"), "workers": k.get("workers"),
                                 "invariantsChecked": preds, "status": res.get("status")})
        elif "Fuzz" in kind:
            k = kind["Fuzz"]
            n["fuzz"] += 1
            fuzz_runs += k.get("runs", 0)
            per_campaign.append({"test": f"{suite}::{name}", "kind": "fuzz", "runs": k.get("runs"), "status": res.get("status")})
        else:
            n["unit"] += 1
    out = header("forge test", _tool_version("forge"), "forge test --json > reports/forge-test.raw.json   (cwd: contracts/)")
    out.update(
        {
            "settings": {
                "fuzz.runs": cfg.get("fuzz", {}).get("runs"),
                "invariant.runs": cfg.get("invariant", {}).get("runs"),
                "invariant.depth": cfg.get("invariant", {}).get("depth"),
                "invariant.fail_on_revert": cfg.get("invariant", {}).get("fail_on_revert"),
                "profile": os.environ.get("FOUNDRY_PROFILE", "default"),
            },
            "tests": {"unit": n["unit"], "fuzz": n["fuzz"], "invariant": n["invariant"], "failed": failed},
            "notes": [
                "Foundry runs the invariant_* functions of one contract in a single shared campaign; its calls are "
                "counted once and every invariant is checked after each call",
                "per-test inline config can override the default fuzz runs (forge-config comments in test files)",
                "the traces field was removed from reports/forge-test.raw.json to keep it small; nothing else was changed",
            ],
            "calls": {
                "invariantHandlerCalls": inv_calls,
                "invariantReverts": inv_reverts,
                "invariantRuns": inv_runs,
                "fuzzRuns": fuzz_runs,
                "total": inv_calls + fuzz_runs,
                "definition": "total = invariant handler calls (all runs x depth) + fuzz-test runs (one call each)",
            },
            "campaigns": per_campaign,
        }
    )
    write("fuzz.json", out)


# ------------------------------------------------------------------------------------------------- versions


def gen_versions():
    out = header("versions", "n/a", "<tool> --version")
    out["tools"] = {
        "forge": _tool_version("forge"),
        "solc": "0.8.23 (foundry.toml, auto_detect_solc = false)",
        "slither": _tool_version("slither"),
        "halmos": _tool_version("halmos"),
        "aderyn": _tool_version("aderyn"),
        "python": sys.version.split()[0],
    }
    write("versions.json", out)


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    jobs = {
        "slither": gen_slither,
        "aderyn": gen_aderyn,
        "coverage": gen_coverage,
        "gas": gen_gas,
        "symbolic": gen_symbolic,
        "fuzz": gen_fuzz,
        "versions": gen_versions,
    }
    for name in jobs if what == "all" else [what]:
        jobs[name]()
