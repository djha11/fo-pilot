from __future__ import annotations

from dataclasses import dataclass


MIN_SAMPLES = 30
PRIOR_TRADES = 20
PRIOR_WIN_RATE = 0.95
MAX_SCORE_ADJUSTMENT = 5.0


@dataclass(frozen=True)
class LearningProfile:
    strategy: str
    expiry_day: bool
    completed_trades: int
    profitable_trades: int
    observed_win_rate: float | None
    conservative_win_rate: float | None
    score_adjustment: float
    active: bool


def build_profile(strategy: str, expiry_day: bool, wins: int, total: int) -> LearningProfile:
    total = max(int(total), 0)
    wins = min(max(int(wins), 0), total)
    observed = wins / total if total else None
    posterior = (wins + PRIOR_TRADES * PRIOR_WIN_RATE) / (total + PRIOR_TRADES)
    active = total >= MIN_SAMPLES
    adjustment = 0.0
    if active:
        adjustment = max(
            -MAX_SCORE_ADJUSTMENT,
            min(MAX_SCORE_ADJUSTMENT, (posterior - PRIOR_WIN_RATE) * 100),
        )
    return LearningProfile(
        strategy=strategy,
        expiry_day=expiry_day,
        completed_trades=total,
        profitable_trades=wins,
        observed_win_rate=round(observed, 4) if observed is not None else None,
        conservative_win_rate=round(posterior, 4) if total else None,
        score_adjustment=round(adjustment, 2),
        active=active,
    )


def apply_learning(candidate: dict, profiles: dict[tuple[str, bool], LearningProfile]) -> dict:
    result = dict(candidate)
    profile = profiles.get((str(result.get("strategy")), bool(result.get("expiry_day"))))
    if profile is None:
        profile = build_profile(str(result.get("strategy")), bool(result.get("expiry_day")), 0, 0)
    result["base_score"] = result.get("score", 0)
    result["score"] = round(max(0.0, min(100.0, float(result["base_score"]) + profile.score_adjustment)), 1)
    result["learning"] = {
        "active": profile.active,
        "completed_trades": profile.completed_trades,
        "minimum_samples": MIN_SAMPLES,
        "score_adjustment": profile.score_adjustment,
        "observed_win_rate": profile.observed_win_rate,
        "conservative_win_rate": profile.conservative_win_rate,
    }
    result.setdefault("rationale", []).append(
        f"Learning adjustment {profile.score_adjustment:+.1f} from {profile.completed_trades} comparable completed trades"
        if profile.active
        else f"Learning is collecting evidence ({profile.completed_trades}/{MIN_SAMPLES} comparable trades)"
    )
    return result
