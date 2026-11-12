package com.judson.kingshot.autoredeemer.data

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.judson.kingshot.autoredeemer.data.api.ApiEnvelope
import com.judson.kingshot.autoredeemer.data.api.PendingRedemption
import com.judson.kingshot.autoredeemer.data.api.PlayerProfile
import com.judson.kingshot.autoredeemer.data.api.RedemptionHistoryItem
import com.judson.kingshot.autoredeemer.data.api.RedemptionResult
import com.judson.kingshot.autoredeemer.data.api.ServiceHealth
import com.judson.kingshot.autoredeemer.data.api.RedeemerApi
import com.judson.kingshot.autoredeemer.data.storage.SecureStorage
import java.util.UUID

class RedeemerRepository(
    private val api: RedeemerApi,
    private val storage: SecureStorage,
    private val gson: Gson
) {
    suspend fun health(): ServiceHealth {
        val response = api.health()
        if (!response.isSuccessful) throw ApiException("Service health check failed (HTTP " + response.code() + ").", response.code())
        return response.body() ?: throw ApiException("The service returned an empty health response.")
    }

    suspend fun lookup(playerId: String): PlayerProfile {
        require(playerId.matches(Regex("\\d{5,20}"))) { "Player ID must contain 5–20 digits." }
        val response = api.player(playerId)
        val envelope = response.body()
        if (!response.isSuccessful || envelope?.success != true) {
            throw ApiException(
                envelope?.error?.message ?: "Player lookup failed (HTTP " + response.code() + ").",
                response.code(),
                envelope?.meta?.requestId
            )
        }
        return envelope.data ?: throw ApiException("The API returned no player data.")
    }

    fun pendingRedemption(): PendingRedemption? =
        storage.read(AppContainer.PENDING_REDEMPTION_STORAGE)?.let {
            runCatching { gson.fromJson(it, PendingRedemption::class.java) }.getOrNull()
        }

    suspend fun redeem(attempt: PendingRedemption): RedemptionResult {
        val response = api.redeem(attempt.request, attempt.idempotencyKey)
        val envelope = response.body()
        if (!response.isSuccessful || envelope?.success != true) {
            throw ApiException(
                envelope?.error?.message ?: "Redemption request failed (HTTP " + response.code() + ").",
                response.code(),
                envelope?.meta?.requestId,
                envelope?.error?.retryHint
            )
        }
        return envelope.data ?: throw ApiException("The API returned no redemption result.")
    }

    fun savePendingRedemption(attempt: PendingRedemption) {
        storage.write(AppContainer.PENDING_REDEMPTION_STORAGE, gson.toJson(attempt))
    }

    fun clearPendingRedemption() {
        storage.remove(AppContainer.PENDING_REDEMPTION_STORAGE)
    }

    suspend fun history(playerId: String): List<RedemptionHistoryItem> {
        require(playerId.matches(Regex("\\d{5,20}"))) { "Enter a valid Player ID first." }
        val response = api.history(playerId)
        if (!response.isSuccessful) throw ApiException("History request failed (HTTP " + response.code() + ").", response.code())
        val root = response.body() ?: return emptyList()
        val data = root.get("data")
        val candidate = when {
            data == null || data.isJsonNull -> root.get("items")
            data.isJsonArray -> data
            data.isJsonObject -> data.asJsonObject.get("items")
                ?: data.asJsonObject.get("records")
                ?: data.asJsonObject.get("history")
            else -> null
        }
        val array = candidate?.takeIf { it.isJsonArray }?.asJsonArray ?: JsonArray()
        return array.mapNotNull { element ->
            if (!element.isJsonObject) return@mapNotNull null
            val item = element.asJsonObject
            RedemptionHistoryItem(
                playerId = item.stringValue("playerId", "player_id") ?: playerId,
                code = item.stringValue("code", "gift_code") ?: "Unknown code",
                status = item.stringValue("status", "status_label") ?: "Unknown",
                createdAt = item.stringValue("createdAt", "created_at") ?: ""
            )
        }
    }

    suspend fun register(playerId: String, kingdomId: String, playerName: String): String {
        require(playerId.matches(Regex("\\d{5,20}"))) { "Player ID must contain 5–20 digits." }
        require(kingdomId.matches(Regex("\\d{1,10}"))) { "Kingdom ID must contain 1–10 digits." }
        val body = JsonObject().apply {
            addProperty("playerId", playerId)
            addProperty("kingdomId", kingdomId)
            if (playerName.isNotBlank()) addProperty("playerName", playerName.take(120))
        }
        val response = api.register(body)
        val result = response.body()
        if (!response.isSuccessful) {
            val message = result?.get("error")?.takeIf { it.isJsonPrimitive }?.asString
            throw ApiException(message ?: "Registration failed (HTTP " + response.code() + ").", response.code())
        }
        return result?.get("message")?.takeIf { it.isJsonPrimitive }?.asString
            ?: result?.get("status")?.takeIf { it.isJsonPrimitive }?.asString
            ?: "Registration request completed."
    }

    private fun JsonObject.stringValue(vararg names: String): String? =
        names.firstNotNullOfOrNull { name ->
            get(name)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.asString
        }
}

class ApiException(
    message: String,
    val status: Int? = null,
    val requestId: String? = null,
    val retryHint: String? = null
) : Exception(message)
