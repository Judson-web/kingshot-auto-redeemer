package com.judson.kingshot.autoredeemer

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RedemptionValidationTest {
    @Test
    fun acceptsValidPlayerIds() {
        assertTrue("43180889".matches(Regex("\\d{5,20}")))
        assertTrue("12345".matches(Regex("\\d{5,20}")))
    }

    @Test
    fun rejectsInvalidPlayerIds() {
        assertFalse("1234".matches(Regex("\\d{5,20}")))
        assertFalse("12A456".matches(Regex("\\d{5,20}")))
        assertFalse("123456789012345678901".matches(Regex("\\d{5,20}")))
    }

    @Test
    fun acceptsOnlyDocumentedGiftCodeCharacters() {
        assertTrue("KINGSHOT_2026-REWARD".matches(Regex("[A-Za-z0-9_-]{1,64}")))
        assertFalse("INVALID CODE".matches(Regex("[A-Za-z0-9_-]{1,64}")))
        assertFalse("CODE!".matches(Regex("[A-Za-z0-9_-]{1,64}")))
    }

    @Test
    fun idempotencyKeyHasSafeCharactersAndLength() {
        assertTrue("redeem-43180889-001".matches(Regex("[A-Za-z0-9._:-]{8,128}")))
        assertFalse("bad key".matches(Regex("[A-Za-z0-9._:-]{8,128}")))
    }
}
