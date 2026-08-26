package com.rork.quizroyaleshowdown.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BadgesTest {
    @Test
    fun `earned badge thresholds are stable`() {
        val stats = PlayerStats(wins = 25, totalPoints = 10_000, correctAnswers = 250)
        val earned = earnedBadges(stats).map { it.id }.toSet()

        assertTrue("wins-1" in earned)
        assertTrue("wins-5" in earned)
        assertTrue("wins-25" in earned)
        assertFalse("wins-100" in earned)
        assertTrue("pts-1000" in earned)
        assertTrue("pts-10000" in earned)
        assertFalse("pts-50000" in earned)
        assertTrue("acc-50" in earned)
        assertTrue("acc-250" in earned)
        assertFalse("acc-1000" in earned)
    }

    @Test
    fun `badge shelf keeps only strongest earned tier per family`() {
        val shelf = badgeShelf(
            PlayerStats(
                wins = 30,
                totalPoints = 12_000,
                correctAnswers = 300,
                bestRank = 8,
                bestPlacement = 1
            )
        )
        val ids = shelf.associateBy({ it.family }, { it.id })

        assertEquals("wins-25", ids[BadgeFamily.WINS])
        assertEquals("rank-10", ids[BadgeFamily.RANK])
        assertEquals("pts-10000", ids[BadgeFamily.POINTS])
        assertEquals("acc-250", ids[BadgeFamily.ACCURACY])
        assertEquals("crown-1st", ids[BadgeFamily.CROWN])
    }

    @Test
    fun `historical best rank earns every qualifying rank milestone`() {
        val ranks = badgesFor(PlayerStats(bestRank = 3))
            .filter { it.family == BadgeFamily.RANK }
            .associateBy { it.id }

        assertTrue(ranks.getValue("rank-100").earned)
        assertTrue(ranks.getValue("rank-10").earned)
        assertTrue(ranks.getValue("rank-3").earned)
        assertFalse(ranks.getValue("rank-1").earned)
    }

    @Test
    fun `next badge chooses closest unearned progress`() {
        val next = nextBadge(PlayerStats(wins = 4, totalPoints = 900))

        assertNotNull(next)
        assertEquals("pts-1000", next?.id)
        assertEquals(0.9f, next?.progress ?: 0f, 0.0001f)
    }

    @Test
    fun `first place crown is permanent from best placement`() {
        assertFalse(badgesFor(PlayerStats(bestPlacement = 2)).first { it.id == "crown-1st" }.earned)
        assertTrue(badgesFor(PlayerStats(bestPlacement = 1)).first { it.id == "crown-1st" }.earned)
    }
}
