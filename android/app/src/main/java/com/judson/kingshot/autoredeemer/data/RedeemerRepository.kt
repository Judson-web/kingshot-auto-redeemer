package com.judson.kingshot.autoredeemer.data

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.judson.kingshot.autoredeemer.data.api.ApiEnvelope
import com.judson.kingshot.autoredeemer.data.api.PendingRedemption
import com.judson.kingshot.autoredeemer.data.api.PlayerProfile
import com.judson.kingshot.autoredeemer.data.api.RedemptionHistoryItem
import com.judson.kingshot.autoredeemer.data.api.RedemptionResult
import com.judson.kingshot.autoredeemer.data.api.RegistrationOutcome
import com.judson.kingshot.autoredeemer.data.api.ServiceHealth
import com.judson.kingshot.autoredeemer.data.api.RedeemerApi
import com.judson.kingshot.autoredeemer.data.storage.SecureStorage
import retrofit2.Response

class RedeemerRepository(
    private val api: RedeemerApi,
    private val storage: SecureStorage,
    private val gson: Gson
) {
    suspend fun startDiscordSignIn(codeChallenge: String): String {
        require(codeChallenge.matches(Regex("[A-Za-z0-9_-]{43}"))) { "Invalid sign-in challenge." }
        val body = JsonObject().apply {
            addProperty("action", "android-discord-url")
            addProperty("code_challenge", codeChallenge)
        }
        val response = api.accountAuth(body)
        if (!response.isSuccessful) throw apiException(response, "Could not start Discord sign-in.")
        return response.body()?.get("url")?.takeIf { it.isJsonPrimitive }?.asString
            ?: throw ApiException("The sign-in service did not return an authorization URL.", response.code())
    }

    suspend fun completeDiscordSignIn(code: String, verifier: String): JsonObject {
        require(code.isNotBlank() && code.length <= 4096) { "Invalid Discord authorization code." }
        require(verifier.matches(Regex("[A-Za-z0-9._~-]{43,128}"))) { "Sign-in attempt expired. Start again." }
        val body = JsonObject().apply {
            addProperty("action", "profile-oauth-exchange")
            addProperty("code", code)
            addProperty("code_verifier", verifier)
        }
        val response = api.accountAuth(body)
        if (!response.isSuccessful) throw apiException(response, "Discord sign-in failed.")
        return response.body() ?: throw ApiException("The sign-in service returned an empty response.", response.code())
    }

    suspend fun discordLogout() {
        val response = api.accountAuth(JsonObject().apply { addProperty("action", "profile-logout") })
        if (!response.isSuccessful) throw apiException(response, "Could not revoke the Discord session.")
        storage.remove(AppContainer.PROFILE_COOKIE_STORAGE)
    }

    suspend fun discordProfile(): JsonObject {
        val response = api.accountAuth(JsonObject().apply { addProperty("action", "profile-check") })
        if (!response.isSuccessful) throw apiException(response, "Could not verify your Discord session.")
        return response.body() ?: throw ApiException("The account service returned an empty response.", response.code())
    }

    suspend fun health(): ServiceHealth {
        val response = api.health()
        if (!response.isSuccessful) throw apiException(response, "Service health check failed.")
        return response.body() ?: throw ApiException(
            "The service returned an empty health response.",
            response.code(),
            response.headers()["X-Request-Id"]
        )
    }

    suspend fun lookup(playerId: String): PlayerProfile {
        require(PLAYER_ID.matches(playerId)) { "Player ID must contain 5–20 digits." }
        val response = api.player(playerId)
        if (!response.isSuccessful) throw apiException(response, "Player lookup failed.")
        val envelope = response.body()
            ?: throw ApiException("The API returned an empty player response.", response.code())
        if (!envelope.success) {
            throw ApiException(
                envelope.error?.message ?: "Player lookup was not successful.",
                response.code(),
                envelope.meta?.requestId,
                envelope.error?.retryHint,
                envelope.error?.retryAfterSeconds
            )
        }
        return envelope.data
            ?: throw ApiException("The API returned no player data.", response.code(), envelope.meta?.requestId)
    }

    fun pendingRedemption(): PendingRedemption? =
        storage.read(AppContainer.PENDING_REDEMPTION_STORAGE)?.let {
            runCatching { gson.fromJson(it, PendingRedemption::class.java) }.getOrNull()
        }

    suspend fun redeem(attempt: PendingRedemption): RedemptionResult {
        require(PLAYER_ID.matches(attempt.request.playerId)) { "Player ID must contain 5–20 digits." }
        require(KINGDOM_ID.matches(attempt.request.kid)) { "Kingdom ID must contain 1–10 digits." }
        require(GIFT_CODE.matches(attempt.request.code)) { "Gift code contains unsupported characters." }
        require(IDEMPOTENCY_KEY.matches(attempt.idempotencyKey)) { "Invalid redemption request reference." }

        val response = api.redeem(attempt.request, attempt.idempotencyKey)
        if (!response.isSuccessful) throw apiException(response, "Redemption request failed.")
        val envelope = response.body()
            ?: throw ApiException("The API returned an empty redemption response.", response.code())
        if (!envelope.success) {
            throw ApiException(
                envelope.error?.message ?: "The redemption request was not accepted.",
                response.code(),
                envelope.meta?.requestId,
                envelope.error?.retryHint,
                envelope.error?.retryAfterSeconds
            )
        }
        return envelope.data
            ?: throw ApiException("The API returned no redemption result.", response.code(), envelope.meta?.requestId)
    }

    fun savePendingRedemption(attempt: PendingRedemption) {
        storage.write(AppContainer.PENDING_REDEMPTION_STORAGE, gson.toJson(attempt))
    }

    fun clearPendingRedemption() {
        storage.remove(AppContainer.PENDING_REDEMPTION_STORAGE)
    }

    suspend fun history(playerId: String): List<RedemptionHistoryItem> {
        require(PLAYER_ID.matches(playerId)) { "Enter a valid Player ID first." }
        val response = api.history(playerId)
        if (!response.isSuccessful) throw apiException(response, "History request failed.")
        val root = response.body() ?: return emptyList()
        val data = root.get("data")
        val payload = data?.takeIf { it.isJsonObject }?.asJsonObject ?: root
        val candidate = when {
            data?.isJsonArray == true -> data
            else -> payload.get("items")
                ?: payload.get("records")
                ?: payload.get("history")
                ?: root.get("items")
        }
        val array = candidate?.takeIf { it.isJsonArray }?.asJsonArray ?: return emptyList()
        return array.mapNotNull { element ->
            if (!element.isJsonObject) return@mapNotNull null
            val item = element.asJsonObject
            RedemptionHistoryItem(
                playerId = item.stringValue("playerId", "player_id") ?: playerId,
                code = item.stringValue("code", "gift_code") ?: "Unknown code",
                status = item.stringValue("status", "status_label") ?: "Unknown",
                createdAt = item.stringValue("createdAt", "created_at", "attemptedAt", "attempted_at").orEmpty(),
                errorCode = item.stringValue("errorCode", "errCode", "err_code"),
                message = item.stringValue("message", "error")
            )
        }
    }

    suspend fun register(playerId: String, kingdomId: String, playerName: String): RegistrationOutcome {
        require(PLAYER_ID.matches(playerId)) { "Player ID must contain 5–20 digits." }
        val normalizedKingdom = kingdomId.trim()
        require(normalizedKingdom.isEmpty() || KINGDOM_ID.matches(normalizedKingdom)) {
            "Kingdom ID must contain 1–10 digits."
        }

        val body = JsonObject().apply {
            addProperty("playerId", playerId.trim())
            if (normalizedKingdom.isNotEmpty()) addProperty("kingdomId", normalizedKingdom)
            if (playerName.isNotBlank()) addProperty("playerName", playerName.trim().take(120))
        }
        val response = api.register(body)
        if (!response.isSuccessful) throw apiException(response, "Registration failed.")
        val result = response.body()
            ?: throw ApiException("The registration service returned an empty response.", response.code())

        val registered = result.booleanValue("registered") == true
        val alreadyRegistered = result.booleanValue("alreadyRegistered") == true
        val status = result.stringValue("registrationStatus")
        val verified = result.booleanValue("kingdomVerified")
        val verificationPending = result.booleanValue("verificationPending")
        val verifiedKingdom = result.stringValue("verifiedKingdomId")
        val message = when {
            !registered -> result.stringValue("message", "error") ?: "The registration could not be confirmed."
            verificationPending == true -> "Player registered. Kingdom verification is still pending."
            verified == true && alreadyRegistered -> "Player is already registered and kingdom verification is confirmed."
            verified == true -> "Player registered and kingdom verification is confirmed."
            alreadyRegistered -> "Player is already registered. Kingdom verification is not yet confirmed."
            else -> "Registration accepted. Check the registration status before relying on it."
        }
        return RegistrationOutcome(
            registered = registered,
            alreadyRegistered = alreadyRegistered,
            registrationStatus = status,
            kingdomVerified = verified,
            verificationPending = verificationPending,
            verifiedKingdomId = verifiedKingdom,
            message = message
        )
    }

    private fun apiException(response: Response<*>, fallback: String): ApiException {
        val raw = runCatching { response.errorBody()?.string() }.getOrNull()
        val root = runCatching {
            raw?.takeIf { it.isNotBlank() }?.let { JsonParser.parseString(it) }?.takeIf { it.isJsonObject }?.asJsonObject
        }.getOrNull()
        val error = root?.get("error")?.takeIf { it.isJsonObject }?.asJsonObject
        val meta = root?.get("meta")?.takeIf { it.isJsonObject }?.asJsonObject
        val message = error?.stringValue("message")
            ?: root?.stringValue("error", "message")
            ?: fallback
        val requestId = meta?.stringValue("requestId")
            ?: response.headers()["X-Request-Id"]
        val retryAfter = error?.longValue("retryAfterSeconds")
            ?: response.headers()["Retry-After"]?.toLongOrNull()
        return ApiException(
            message = message,
            status = response.code(),
            requestId = requestId,
            retryHint = error?.stringValue("retryHint"),
            retryAfterSeconds = retryAfter
        )
    }

    private fun JsonObject.stringValue(vararg names: String): String? =
        names.firstNotNullOfOrNull { name ->
            get(name)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.asString?.takeIf(String::isNotBlank)
        }

    private fun JsonObject.booleanValue(name: String): Boolean? =
        get(name)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.let {
            runCatching { it.asBoolean }.getOrNull()
        }

    private fun JsonObject.longValue(name: String): Long? =
        get(name)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.let {
            runCatching { it.asLong }.getOrNull()
        }

    private companion object {
        val PLAYER_ID = Regex("\\d{5,20}")
        val KINGDOM_ID = Regex("\\d{1,10}")
        val GIFT_CODE = Regex("[A-Za-z0-9_-]{1,64}")
        val IDEMPOTENCY_KEY = Regex("[A-Za-z0-9._:-]{8,128}")
    }
}

class ApiException(
    message: String,
    val status: Int? = null,
    val requestId: String? = null,
    val retryHint: String? = null,
    val retryAfterSeconds: Long? = null
) : Exception(message)
