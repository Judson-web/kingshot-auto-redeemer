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
        val rawUrl = response.body()?.get("url")?.takeIf { it.isJsonPrimitive }?.asString
            ?: throw ApiException("The sign-in service did not return an authorization URL.", response.code())
        val authorization = android.net.Uri.parse(rawUrl)
        require(authorization.scheme == "https" && authorization.path == "/auth/v1/authorize") {
            "The sign-in service returned an unsafe authorization URL."
        }
        val redirectValue = authorization.getQueryParameter("redirect_to")
            ?: throw ApiException("The sign-in service returned an incomplete callback URL.", response.code())
        val redirect = android.net.Uri.parse(redirectValue)
        require(
            redirect.scheme == "https" &&
                redirect.host == "app.ks-redeemer.workers.dev" &&
                redirect.path == "/profile" &&
                redirect.getQueryParameter("native") == "1" &&
                redirect.getQueryParameter("provider") == "discord"
        ) { "The sign-in service returned an unexpected native callback destination." }
        return rawUrl
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
        val response = api.publicPlayer(playerId)
        if (!response.isSuccessful) throw apiException(response, "Player lookup failed.")
        val root = response.body() ?: throw ApiException("The player service returned an empty response.", response.code())
        val data = root.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
        val player = root.get("player")?.takeIf { it.isJsonObject }?.asJsonObject
            ?: data?.get("player")?.takeIf { it.isJsonObject }?.asJsonObject ?: data ?: root
        val stats = player.get("stats")?.takeIf { it.isJsonObject }?.asJsonObject
            ?: player.get("statistics")?.takeIf { it.isJsonObject }?.asJsonObject
        fun first(vararg names: String): JsonElement? = names.firstNotNullOfOrNull { name ->
            player.get(name)?.takeUnless { it.isJsonNull } ?: stats?.get(name)?.takeUnless { it.isJsonNull }
        }
        fun text(vararg names: String): String? = first(*names)?.takeIf { it.isJsonPrimitive }?.asString?.trim()?.takeIf(String::isNotBlank)
        fun number(vararg names: String): Long? = first(*names)?.let {
            if (!it.isJsonPrimitive) null else runCatching { if (it.asJsonPrimitive.isNumber) it.asLong else it.asString.replace(",", "").toLong() }.getOrNull()
        }
        val returnedId = text("governor_id", "fid", "player_id", "playerId", "id")
        if (returnedId != playerId) throw ApiException("The provider returned a different player ID.", response.code())
        val alliance = player.get("alliance")?.takeIf { it.isJsonObject }?.asJsonObject
        val frame = runCatching { api.avatarFrame(playerId = playerId).body()?.getAsJsonObject("frame") }.getOrNull()
        val frameAssetId = frame?.get("assetId")?.takeIf { it.isJsonPrimitive }?.asString
            ?.takeIf { it.matches(Regex("\\d{6,12}")) }
        val frameName = frame?.get("name")?.takeIf { it.isJsonPrimitive }?.asString?.take(80)
        return PlayerProfile(
            playerId = returnedId, name = text("nick_name", "name", "nickname", "player_name", "display_name"),
            kingdomId = text("kid", "kingdom_id", "kingdomId"), power = number("power", "total_power", "totalPower"),
            townCenterLevel = number("town_center_level", "townCenterLevel", "castle_level", "level")?.toInt(),
            avatarUrl = text("avatar_url", "avatarUrl", "avatar"),
            allianceName = alliance?.get("name")?.takeIf { it.isJsonPrimitive }?.asString ?: text("alliance_name", "allianceName"),
            allianceTag = alliance?.get("abbr")?.takeIf { it.isJsonPrimitive }?.asString ?: alliance?.get("tag")?.takeIf { it.isJsonPrimitive }?.asString ?: text("alliance_abbr", "alliance_tag", "allianceTag"),
            vipLevel = number("vip_level", "vipLevel", "vip")?.toInt(), kills = number("kills", "kill_count", "killCount"),
            deaths = number("deaths", "death_count", "deathCount"), alliancePower = number("alliance_power", "alliancePower"),
            rank = number("rank", "alliance_rank", "allianceRank")?.toInt(), lastActive = text("last_active", "lastActive", "last_login", "lastLogin")
        )
    }

    fun pendingRedemption(): PendingRedemption? =
        storage.read(AppContainer.PENDING_REDEMPTION_STORAGE)?.let {
            runCatching { gson.fromJson(it, PendingRedemption::class.java) }.getOrNull()
        }

    suspend fun redeem(attempt: PendingRedemption): RedemptionResult {
        require(PLAYER_ID.matches(attempt.request.playerId)) { "Player ID must contain 5–20 digits." }
        require(KINGDOM_ID.matches(attempt.request.kid)) { "Kingdom ID must contain 1–10 digits." }
        require(PUBLIC_GIFT_CODE.matches(attempt.request.code)) { "Gift codes must contain 6–32 letters, numbers, underscores, or hyphens." }

        val body = JsonObject().apply {
            addProperty("playerId", attempt.request.playerId)
            addProperty("code", attempt.request.code)
            addProperty("kid", attempt.request.kid)
        }
        val response = api.publicRedeem(body)
        val result = response.body()
        if (!response.isSuccessful) {
            val code = result?.stringValue("code")
            val message = result?.stringValue("error", "message") ?: "Redemption request failed."
            throw ApiException(
                message,
                response.code(),
                response.headers()["X-Request-Id"],
                if (code == "redemption_outcome_needs_review" || code == "redemption_unresolved") "do_not_retry" else null,
                result?.longValue("retryAfterSeconds") ?: response.headers()["Retry-After"]?.toLongOrNull()
            )
        }
        val payload = result ?: throw ApiException("The redemption service returned an empty response.", response.code())
        return RedemptionResult(
            ok = payload.booleanValue("ok"),
            status = payload.stringValue("status"),
            statusLabel = payload.stringValue("statusLabel"),
            message = payload.stringValue("message", "error"),
            errorCategory = payload.stringValue("errorCategory"),
            errCode = payload.stringValue("errCode")
        )
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


    suspend fun giftCodes(): JsonObject {
        val response = api.giftCodes()
        if (!response.isSuccessful) throw apiException(response, "Verified gift codes are unavailable.")
        return response.body() ?: throw ApiException("Gift-code service returned an empty response.", response.code())
    }

    suspend fun searchAlliances(kingdomId: String, query: String): JsonObject {
        require(KINGDOM_ID.matches(kingdomId)) { "Kingdom ID must contain 1–10 digits." }
        val response = api.allianceLookup(kingdomId, "search", query = query.trim().take(80).ifBlank { null })
        if (!response.isSuccessful) throw apiException(response, "Alliance rankings are unavailable.")
        return response.body() ?: throw ApiException("Alliance service returned an empty response.", response.code())
    }

    suspend fun allianceRoster(kingdomId: String, tag: String): JsonObject {
        require(KINGDOM_ID.matches(kingdomId)) { "Kingdom ID must contain 1–10 digits." }
        require(ALLIANCE_TAG.matches(tag)) { "Enter a valid alliance tag." }
        val response = api.allianceLookup(kingdomId, tag = tag)
        if (!response.isSuccessful) throw apiException(response, "Alliance roster is unavailable.")
        return response.body() ?: throw ApiException("Alliance service returned an empty response.", response.code())
    }

    suspend fun allianceRegistrationStatus(playerIds: List<String>): Set<String> {
        require(playerIds.isNotEmpty() && playerIds.size <= 200 && playerIds.all { PLAYER_ID.matches(it) }) {
            "Alliance roster contains invalid player IDs."
        }
        val response = api.allianceLookup("", mode = "registration-status", ids = playerIds.distinct().joinToString(","))
        if (!response.isSuccessful) throw apiException(response, "Could not verify existing registrations.")
        val rows = response.body()?.get("registeredIds")?.takeIf { it.isJsonArray }?.asJsonArray
            ?: throw ApiException("Registration status was not confirmed.", response.code())
        return rows.mapNotNull { it.takeIf { value -> value.isJsonPrimitive }?.asString }.toSet()
    }


    suspend fun allianceSyncConfigs(): List<JsonObject> {
        val response = api.allianceSyncList()
        if (!response.isSuccessful) throw apiException(response, "Could not load alliance sync configurations.")
        val rows = response.body()?.get("configs")?.takeIf { it.isJsonArray }?.asJsonArray
            ?: throw ApiException("Alliance sync service returned an invalid configuration list.", response.code())
        return rows.mapNotNull { it.takeIf { value -> value.isJsonObject }?.asJsonObject }
    }

    suspend fun allianceSyncAction(action: String, id: String): JsonObject {
        require(action in setOf("pause", "resume", "sync")) { "Unsupported alliance sync action." }
        require(id.matches(Regex("[0-9a-fA-F-]{36}"))) { "Choose a valid alliance configuration." }
        val body = JsonObject().apply { addProperty("action", action); addProperty("id", id) }
        val response = api.allianceSyncAction(body)
        if (!response.isSuccessful) throw apiException(response, "Alliance sync action failed.")
        return response.body() ?: throw ApiException("Alliance sync service returned an empty response.", response.code())
    }

    suspend fun allianceSyncProgress(kingdomId: String, tag: String): JsonObject {
        val response = api.allianceSyncQuery("progress", kingdomId, tag)
        if (!response.isSuccessful) throw apiException(response, "Could not load alliance sync progress.")
        return response.body() ?: throw ApiException("Alliance sync service returned an empty response.", response.code())
    }

    suspend fun allianceSyncHistory(kingdomId: String, tag: String): JsonObject {
        val response = api.allianceSyncQuery("history", kingdomId, tag)
        if (!response.isSuccessful) throw apiException(response, "Could not load alliance sync history.")
        return response.body() ?: throw ApiException("Alliance sync service returned an empty response.", response.code())
    }

    suspend fun registerAlliance(kingdomId: String, tag: String): JsonObject {
        require(KINGDOM_ID.matches(kingdomId) && ALLIANCE_TAG.matches(tag)) { "Check the kingdom ID and alliance tag." }
        val body = JsonObject().apply {
            addProperty("action", "register-alliance")
            addProperty("kingdomId", kingdomId)
            addProperty("allianceTag", tag)
        }
        val response = api.allianceSync(body)
        if (!response.isSuccessful) throw apiException(response, "Alliance registration failed.")
        return response.body() ?: throw ApiException("Alliance registration was not confirmed.", response.code())
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
            retryHint = error?.stringValue("retryHint") ?: when (root?.stringValue("code")) {
                "redemption_outcome_needs_review", "redemption_unresolved" -> "do_not_retry"
                else -> null
            },
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
        val PUBLIC_GIFT_CODE = Regex("[A-Za-z0-9_-]{6,32}")
        val ALLIANCE_TAG = Regex("[A-Za-z0-9_-]{1,20}")
    }
}

class ApiException(
    message: String,
    val status: Int? = null,
    val requestId: String? = null,
    val retryHint: String? = null,
    val retryAfterSeconds: Long? = null
) : Exception(message)
