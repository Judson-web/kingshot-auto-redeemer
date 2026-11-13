package com.judson.kingshot.autoredeemer.data.api

import com.google.gson.annotations.SerializedName

data class ApiEnvelope<T>(
    val success: Boolean = false,
    val data: T? = null,
    val error: ApiError? = null,
    val meta: ApiMeta? = null
)

data class ApiError(
    val code: String? = null,
    val message: String? = null,
    val retryable: Boolean? = null,
    val retryHint: String? = null,
    val retryAfterSeconds: Long? = null
)

data class ApiMeta(
    val apiVersion: String? = null,
    val requestId: String? = null,
    val timestamp: String? = null,
    val stale: Boolean? = null
)

data class PlayerProfile(
    val playerId: String? = null,
    val name: String? = null,
    val kingdomId: String? = null,
    val power: Long? = null,
    val townCenterLevel: Int? = null,
    val avatarUrl: String? = null,
    val allianceName: String? = null,
    val allianceTag: String? = null
)

data class RedemptionRequest(
    val playerId: String,
    val code: String,
    val kid: String
)

data class RedemptionResult(
    val ok: Boolean? = null,
    val status: String? = null,
    val statusLabel: String? = null,
    val message: String? = null,
    val errorCategory: String? = null,
    val errCode: String? = null
)

data class ServiceHealth(
    val healthy: Boolean? = null,
    val status: String? = null,
    val lastCompletedAt: String? = null,
    val runningSince: String? = null,
    val ageSeconds: Long? = null,
    val locked: Boolean? = null
)

data class PendingRedemption(
    @SerializedName(value = "requestId", alternate = ["idempotencyKey"])
    val requestId: String,
    val request: RedemptionRequest,
    val outcomeNeedsReview: Boolean = false
)

data class RedemptionHistoryItem(
    val playerId: String,
    val code: String,
    val status: String,
    val createdAt: String,
    val errorCode: String? = null,
    val message: String? = null
)

data class RegistrationOutcome(
    val registered: Boolean,
    val alreadyRegistered: Boolean,
    val registrationStatus: String?,
    val kingdomVerified: Boolean?,
    val verificationPending: Boolean?,
    val verifiedKingdomId: String?,
    val message: String
)
