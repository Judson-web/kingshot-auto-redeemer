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

    @GET("api/v4/players/{playerId}")
    suspend fun player(@Path("playerId") playerId: String): Response<ApiEnvelope<PlayerProfile>>

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

    @POST("api/kingshot-register")
    suspend fun register(@Body body: JsonObject): Response<JsonObject>
}
