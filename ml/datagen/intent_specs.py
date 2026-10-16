"""Spec builder and writer prompts for the M4 intent / mandate dataset (label-first)."""
from __future__ import annotations

import random

from common import intent_sampler as S

LANG_W = {"en": 32, "bn": 24, "mixed": 26, "zh": 18}
MIXED_STYLES = ["Bangla script mixed with English words (for money words, names and app terms)",
                "Romanised Bangla (Banglish, Latin letters) mixed with English", "mostly English with a few Bangla words in Bangla script"]
TONES = ["casual chat message", "short and terse", "polite and complete", "typed quickly on a phone with small typos", "voice-note style, slightly rambling"]


def build_specs(n_intent: int, n_mandate: int, seed: int, scenarios: dict) -> list[dict]:
    rng = random.Random(seed)
    sc_ids = sorted(scenarios)
    specs = []
    for i in range(n_intent + n_mandate):
        task = "intent" if i < n_intent else "mandate"
        sc = scenarios[rng.choice(sc_ids)]
        lang = rng.choices(list(LANG_W), list(LANG_W.values()))[0]
        today = S.random_today(rng)
        if task == "intent":
            label, hints = S.sample_intent(sc, rng, lang, today)
        else:
            label, hints = S.sample_mandate(sc, rng, lang, today)
        spec = {"id": f"{task[:3]}-{seed}-{i:05d}", "task": task, "scenario": sc["id"], "language": lang, "today": today.isoformat(),
                "label": label, "hints": hints, "tone": rng.choice(TONES)}
        if lang == "mixed":
            spec["mixed_style"] = rng.choice(MIXED_STYLES)
        specs.append(spec)
    return specs


def writer_prompt(spec: dict, scenarios: dict) -> list[dict]:
    sc = scenarios[spec["scenario"]]
    who = ("Nadia, a university student from Bangladesh living in Hong Kong" if sc["id"] == "nadia"
           else "the finance manager of Lotus Lane Trading, a small Shenzhen trading company with a Hong Kong subsidiary")
    lang = S.LANG_STYLE[spec["language"]]
    if spec["language"] == "mixed":
        lang = f"code-mixed Bangla-English: {spec['mixed_style']}"
    sys = ("You write realistic messages that a person types to their AI wallet assistant. Output ONLY the message text: "
           "no quotes, no translation, no explanation, no JSON. Never include a wallet address.")
    if spec["task"] == "intent":
        body = [f"Speaker: {who}.", f"Language: {lang}.", f"Tone: {spec['tone']}.", f"Today is {spec['today']}.",
                f"The message must express exactly this request (do not add other requests): kind = {spec['label']['kind']}."]
    else:
        body = [f"Speaker: {who}.", f"Language: {lang}.", f"Tone: {spec['tone']}.", f"Today is {spec['today']}.",
                "The message sets up standing rules (a mandate) for the wallet assistant. It must state exactly these rules and nothing else:"]
    body += [f"- {h}" for h in spec["hints"]]
    body.append("Write the message now.")
    return [{"role": "system", "content": sys}, {"role": "user", "content": "\n".join(body)}]
