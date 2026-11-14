package com.judson.kingshot.autoredeemer.data.api

import com.google.gson.JsonObject
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface RedeemerApi {
    @POST("api/kingshot-player?developer=account-auth")
    suspend fun accountAuth(@Body body: JsonObject): Response<JsonObject>

    @GET("api/kingshot-health")
    suspend fun health(): Response<ServiceHealth>

    @GET("api/kingshot-player")
    suspend fun publicPlayer(@Query("id") playerId: String): Response<JsonObject>

    @GET("api/kingshot-player")
    suspend fun avatarFrame(@Query("frame") mode: String = "profile", @Query("id") playerId: String): Response<JsonObject>

    @GET("api/v4/players/{playerId}")
    suspend fun player(@Path("playerId") playerId: String): Response<ApiEnvelope<PlayerProfile>>

    @POST("api/kingshot-redeem")
    suspend fun publicRedeem(@Body request: JsonObject): Response<JsonObject>

    @POST("api/v4/redemptions")
    suspend fun redeem(
        @Body request: RedemptionRequest,
        @Header("Idempotency-Key") idempotencyKey: String
    ): Response<ApiEnvelope<RedemptionResult>>

    @GET("api/v4/redemption-history")
    suspend fun history(
        @Query("playerId") playerId: String,
        @Query("limit") limit: Int = 25,
        @Query("offset") offset: Int = 0
    ): Response<JsonObject>

    @GET("api/kingshot-gift-codes")
    suspend fun giftCodes(): Response<JsonObject>

    @GET("api/kingshot-admin-data?public=announcements")
    suspend fun publicAnnouncements(): Response<JsonObject>

    @GET("api/kingshot-player?developerPath=alliance-lookup")
    suspend fun allianceLookup(
        @Query("kingdomId") kingdomId: String,
        @Query("mode") mode: String? = null,
        @Query("tag") tag: String? = null,
        @Query("q") query: String? = null,
        @Query("ids") ids: String? = null
    ): Response<JsonObject>

    @GET("api/kingshot-alliance-sync")
    suspend fun allianceSyncList(): Response<JsonObject>

    @GET("api/kingshot-alliance-sync")
    suspend fun allianceSyncQuery(
        @Query("action") action: String,
        @Query("kingdomId") kingdomId: String,
        @Query("allianceTag") allianceTag: String
    ): Response<JsonObject>

    @POST("api/kingshot-alliance-sync")
    suspend fun allianceSyncAction(@Body body: JsonObject): Response<JsonObject>

    @POST("api/kingshot-player?developer=alliance-sync")
    suspend fun allianceSync(@Body body: JsonObject): Response<JsonObject>

    @GET("api/kingshot-admin-data")
    suspend fun adminMaintenance(@Query("maintenanceOnly") maintenanceOnly: Int = 1): Response<JsonObject>

    @POST("api/kingshot-admin-data")
    suspend fun updateAdminMaintenance(@Body body: JsonObject): Response<JsonObject>

    @GET("api/kingshot-admin-data")
    suspend fun adminPlayers(
        @Query("playerPage") page: Int = 1,
        @Query("playerPageSize") pageSize: Int = 25,
        @Query("playerSearch") search: String = "",
        @Query("playerStatus") status: String = "all"
    ): Response<JsonObject>

    @GET("api/kingshot-admin-data")
    suspend fun adminPlayerHistory(@Query("playerHistory") playerId: String): Response<JsonObject>

    @POST("api/kingshot-admin-data")
    suspend fun adminPlayerAction(@Body body: JsonObject): Response<JsonObject>

    @POST("api/kingshot-register")
    suspend fun register(@Body body: JsonObject): Response<JsonObject>
}
