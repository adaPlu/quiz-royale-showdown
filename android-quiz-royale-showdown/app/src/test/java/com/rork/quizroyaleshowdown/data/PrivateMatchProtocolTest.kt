package com.rork.quizroyaleshowdown.data

import org.junit.Assert.assertEquals
import org.junit.Test

class PrivateMatchProtocolTest {
    @Test
    fun `private assignment maps server mode and ticket without client recomputation`() {
        val privateRoom = PrivateMatchResponse(
            code = "AB2CD3",
            roomId = "private-AB2CD3-tournament-hard-nonce",
            roomTicket = "signed-room-ticket",
            mode = GameMode.TOURNAMENT,
            difficulty = MatchDifficulty.HARD,
            createdAt = 1L,
            updatedAt = 2L
        )

        val assignment = privateRoom.asMatchmakeResponse()

        assertEquals("private-AB2CD3-tournament-hard-nonce", assignment.roomId)
        assertEquals("signed-room-ticket", assignment.roomTicket)
        assertEquals(GameMode.TOURNAMENT, assignment.mode)
    }

    @Test
    fun `all server difficulty values are represented by Android protocol`() {
        assertEquals(
            setOf("EASY", "MEDIUM", "HARD", "MIXED"),
            MatchDifficulty.entries.map { it.name }.toSet()
        )
    }
}
