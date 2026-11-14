package com.judson.kingshot.autoredeemer.data

import android.content.Context
import com.google.gson.Gson
import com.judson.kingshot.autoredeemer.data.api.RedeemerApi
import com.judson.kingshot.autoredeemer.data.storage.SecureStorage
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class AppContainer(context: Context) {
    val secureStorage = SecureStorage(context)
    private val gson = Gson()

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(25, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .addInterceptor(Interceptor { chain ->
            val original = chain.request()
            val requestBuilder = original.newBuilder()
                .header("Accept", "application/json")
                .header("User-Agent", "KingshotAutoRedeemer-Android/1.3")
            if (original.url.encodedPath == "/api/kingshot-player" ||
                original.url.encodedPath == "/api/kingshot-alliance-sync" ||
                original.url.encodedPath == "/api/kingshot-admin-data") {
                val cookies = listOf(
                    secureStorage.read(PROFILE_COOKIE_STORAGE),
                    secureStorage.read(OWNER_COOKIE_STORAGE)
                ).filterNot { it.isNullOrBlank() }.joinToString("; ")
                if (cookies.isNotBlank()) requestBuilder.header("Cookie", cookies)
            }
            if (original.url.encodedPath.startsWith("/api/v4/")) {
                secureStorage.read(API_KEY_STORAGE)
                    ?.takeIf(String::isNotBlank)
                    ?.let { requestBuilder.header("Authorization", "Bearer $it") }
            }
            val response = chain.proceed(requestBuilder.build())
            response.headers("Set-Cookie").forEach { cookie ->
                when {
                    cookie.startsWith("__Host-ks_profile_session=") ->
                        secureStorage.write(PROFILE_COOKIE_STORAGE, cookie.substringBefore(";"))
                    cookie.startsWith("__Host-ks_owner_session=") ->
                        secureStorage.write(OWNER_COOKIE_STORAGE, cookie.substringBefore(";"))
                }
            }
            response
        })
        .build()

    val api: RedeemerApi = Retrofit.Builder()
        .baseUrl(API_BASE_URL)
        .client(httpClient)
        .addConverterFactory(GsonConverterFactory.create(gson))
        .build()
        .create(RedeemerApi::class.java)

    val repository = RedeemerRepository(api, secureStorage, gson)

    companion object {
        const val API_BASE_URL = "https://app.ks-redeemer.workers.dev/"
        const val API_KEY_STORAGE = "developer_api_key"
        const val PENDING_REDEMPTION_STORAGE = "pending_redemption"
        const val PROFILE_COOKIE_STORAGE = "discord_profile_cookie"
        const val OWNER_COOKIE_STORAGE = "discord_owner_cookie"
        const val DISCORD_PKCE_STORAGE = "discord_pkce_verifier"
    }
}
