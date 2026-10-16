"""Save the real training curves (trainer_state.json log_history) of the team's sentinel and intent models from
their HuggingFace repos into ml/results/curves/<repo>.json, with the repo revision they came from.
Usage: HF_TOKEN=<read token> uv run python scripts/fetch_curves.py"""
import json, os, re, sys
from huggingface_hub import HfApi, hf_hub_download

token = os.environ.get("HF_TOKEN")
if not token:
    sys.exit("set HF_TOKEN (the model repos are private)")
api = HfApi(token=token)
out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results", "curves")
os.makedirs(out_dir, exist_ok=True)
repos = [r.id for r in api.list_models(author="ABRUBAB") if r.id.split("/")[1].startswith(("yl-sentinel", "yl-intent"))]
print("repos:", repos)
for repo in repos:
    try:
        files = api.list_repo_files(repo)
    except Exception as e:
        print(repo, "list failed", type(e).__name__)
        continue
    states = [f for f in files if f.endswith("trainer_state.json")]
    logs = [f for f in files if re.search(r"(log_history|train_log|metrics|history)\.json$", f)]
    print(repo, "trainer_state:", states[:3], "logs:", logs[:3])
    for f in (states[:1] or logs[:1]):
        p = hf_hub_download(repo, f, token=token)
        d = json.load(open(p, encoding="utf8"))
        hist = d.get("log_history", d if isinstance(d, list) else [])
        pts = [{k: v for k, v in h.items() if k in ("step", "epoch", "loss", "eval_loss", "eval_macro_f1", "eval_f1", "learning_rate", "grad_norm")} for h in hist if isinstance(h, dict)]
        pts = [x for x in pts if len(x) > 1]
        rev = api.model_info(repo).sha
        name = repo.split("/")[1]
        json.dump({"schema": "yinglong.training-curve/1", "repo": repo, "revision": rev, "file": f, "points": pts}, open(os.path.join(out_dir, f"{name}.json"), "w", encoding="utf8"), indent=1)
        print("saved", name, len(pts), "points")
