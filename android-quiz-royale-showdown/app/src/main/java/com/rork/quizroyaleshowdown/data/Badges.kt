package com.rork.quizroyaleshowdown.data

/**
 * The badge catalog. Deliberately a pure derivation from [PlayerStats] so the
 * server only ever stores raw counters and there is exactly one definition of
 * what each badge means.
 *
 * Every counter a badge reads is monotonic (wins, points, correct answers) or a
 * running best (`bestPlacement`, `bestRank`), which is what makes an earned
 * badge permanent: nothing a player does later can un-earn one.
 */

/** Which family a badge belongs to, used for grouping and accent colour. */
enum class BadgeFamily { WINS, RANK, POINTS, ACCURACY, CROWN }

data class Badge(
    val id: String,
    val family: BadgeFamily,
    val label: String,
    /** What earning it means, phrased for the player. */
    val detail: String,
    val earned: Boolean,
    /** 0..1 toward earning this badge. 1 once earned. */
    val progress: Float,
    /** Human-readable "where you are now" for locked badges. */
    val progressLabel: String
)

private data class Tier(val id: String, val label: String, val target: Int, val detail: String)

private val WIN_TIERS = listOf(
    Tier("wins-1", "First Blood", 1, "Win your first match"),
    Tier("wins-5", "Contender", 5, "Win 5 matches"),
    Tier("wins-25", "Gladiator", 25, "Win 25 matches"),
    Tier("wins-100", "Immortal", 100, "Win 100 matches")
)

private val POINT_TIERS = listOf(
    Tier("pts-1000", "Scorer", 1_000, "Bank 1,000 career points"),
    Tier("pts-10000", "High Roller", 10_000, "Bank 10,000 career points"),
    Tier("pts-50000", "Point Tyrant", 50_000, "Bank 50,000 career points")
)

private val ACCURACY_TIERS = listOf(
    Tier("acc-50", "Quick Study", 50, "Answer 50 questions correctly"),
    Tier("acc-250", "Sharpshooter", 250, "Answer 250 questions correctly"),
    Tier("acc-1000", "Encyclopedia", 1_000, "Answer 1,000 questions correctly")
)

/** Leaderboard milestones. Lower rank is better, so these read in reverse. */
private val RANK_TIERS = listOf(
    Tier("rank-100", "Ranked", 100, "Reach the world top 100"),
    Tier("rank-10", "Top Ten", 10, "Reach the world top 10"),
    Tier("rank-3", "Podium", 3, "Reach the world top 3"),
    Tier("rank-1", "World No.1", 1, "Hold world rank #1")
)

/** Builds the full catalog for [stats], earned flags and progress included. */
fun badgesFor(stats: PlayerStats): List<Badge> {
    val badges = mutableListOf<Badge>()

    badges += WIN_TIERS.map { tier ->
        countBadge(BadgeFamily.WINS, tier, stats.wins, "wins")
    }
    badges += RANK_TIERS.map { tier -> rankBadge(tier, stats.bestRank) }
    badges += POINT_TIERS.map { tier ->
        countBadge(BadgeFamily.POINTS, tier, stats.totalPoints, "pts")
    }
    badges += ACCURACY_TIERS.map { tier ->
        countBadge(BadgeFamily.ACCURACY, tier, stats.correctAnswers, "correct")
    }

    // A one-off rather than a tier ladder: finishing a match in first place.
    val crowned = stats.bestPlacement != null && stats.bestPlacement <= 1
    badges += Badge(
        id = "crown-1st",
        family = BadgeFamily.CROWN,
        label = "Last One Standing",
        detail = "Finish a match in 1st place",
        earned = crowned,
        progress = if (crowned) 1f else 0f,
        progressLabel = stats.bestPlacement?.let { "best finish #$it" } ?: "no matches yet"
    )

    return badges
}

private fun countBadge(
    family: BadgeFamily,
    tier: Tier,
    current: Int,
    unit: String
): Badge {
    val earned = current >= tier.target
    return Badge(
        id = tier.id,
        family = family,
        label = tier.label,
        detail = tier.detail,
        earned = earned,
        progress = if (earned) 1f else (current.toFloat() / tier.target).coerceIn(0f, 1f),
        progressLabel = "${formatCount(current)} / ${formatCount(tier.target)} $unit"
    )
}

/**
 * Rank badges invert the usual comparison: rank 1 is the best possible result,
 * so a badge is earned when the best rank ever held is at or below the target.
 * Progress for a locked rank badge is intentionally coarse — there is no
 * meaningful "percentage" of being top 10, so it reports the gap instead.
 */
private fun rankBadge(tier: Tier, bestRank: Int?): Badge {
    val earned = bestRank != null && bestRank <= tier.target
    val progress = when {
        earned -> 1f
        bestRank == null -> 0f
        // Scale the remaining distance so a near miss reads as nearly there.
        else -> (tier.target.toFloat() / bestRank.toFloat()).coerceIn(0f, 0.95f)
    }
    return Badge(
        id = tier.id,
        family = BadgeFamily.RANK,
        label = tier.label,
        detail = tier.detail,
        earned = earned,
        progress = progress,
        progressLabel = bestRank?.let { "best rank #$it" } ?: "unranked"
    )
}

private fun formatCount(value: Int): String = when {
    value >= 1_000_000 -> "${value / 1_000_000}m"
    value >= 10_000 -> "${value / 1_000}k"
    value >= 1_000 -> String.format("%.1fk", value / 1_000f).removeSuffix(".0k") + "k"
    else -> value.toString()
}.let { if (it.endsWith("kk")) it.dropLast(1) else it }

/** Badges the player has actually earned, strongest family tiers last. */
fun earnedBadges(stats: PlayerStats): List<Badge> = badgesFor(stats).filter { it.earned }

/**
 * The single most useful "next goal": the closest unearned badge by progress.
 * Drives the nudge shown under the badge shelf.
 */
fun nextBadge(stats: PlayerStats): Badge? =
    badgesFor(stats).filter { !it.earned }.maxByOrNull { it.progress }

/**
 * Highest earned tier per family, which is what a compact shelf should show —
 * displaying "First Blood" next to "Immortal" would just be noise.
 */
fun badgeShelf(stats: PlayerStats): List<Badge> {
    val all = badgesFor(stats)
    return BadgeFamily.entries.mapNotNull { family ->
        all.filter { it.family == family && it.earned }.lastOrNull()
    }
}
