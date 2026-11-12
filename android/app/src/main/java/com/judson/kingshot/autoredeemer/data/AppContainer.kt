package com.judson.kingshot.autoredeemer.data

import android.content.Context
import com.google.gson.Gson
import com.judson.kingshot.autoredeemer.data.api.RedeemerApi
import com.judson.kingshot.autoredeemer.data.storage.SecureStorage
import okhttp3.OkHttpClient
import okhttp3.Interceptor
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
        .addInterceptor(Interceptor { chain ->
            val request = chain.request().newBuilder()
                .header("Accept", "application/json")
                .header("User-Agent", "KingshotAutoRedeemer-Android/1.0")
                .apply {
                    secureStorage.read(API_KEY_STORAGE)?.takeIf(String::isNotBlank)?.let {
                        header("Authorization", "Bearer " + it)
                    }
                }
                .build()
            chain.proceed(request)
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
    }
}
