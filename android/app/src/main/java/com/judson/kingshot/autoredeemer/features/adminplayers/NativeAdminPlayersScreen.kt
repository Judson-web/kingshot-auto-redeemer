package com.judson.kingshot.autoredeemer.features.adminplayers

import com.google.gson.JsonObject
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ShieldCheck
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.judson.kingshot.autoredeemer.data.AppContainer
import kotlinx.coroutines.launch

@Composable
fun NativeAdminPlayersScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onOpenAccount: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf(emptyList<JsonObject>()) }
    var bans by remember { mutableStateOf(emptyMap<String, JsonObject>()) }
    var selectedId by remember { mutableStateOf("") }
    var history by remember { mutableStateOf(emptyList<JsonObject>()) }
    var search by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("Abuse or invalid registration") }
    var page by remember { mutableStateOf(1) }
    var totalPages by remember { mutableStateOf(1) }
    var totalCount by remember { mutableStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var historyLoading by remember { mutableStateOf(false) }
    var accessDenied by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }

    fun JsonObject.textValue(key: String): String =
        get(key)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.asString.orEmpty()
    fun JsonObject.booleanValue(key: String): Boolean =
        get(key)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.asBoolean == true

    suspend fun load(targetPage: Int = page) {
        loading = true
        error = null
        try {
            container.repository.ensureOwnerSession()
            val response = container.api.adminPlayers(targetPage, 25, search.trim().take(80), "all")
            if (!response.isSuccessful) {
                if (response.code() == 401 || response.code() == 403) accessDenied = true
                throw IllegalStateException(
                    when (response.code()) {
                        401 -> "The administrator session expired. Sign in again."
                        403 -> "This Discord account cannot view player administration."
                        else -> "Player database request failed (HTTP ${response.code()})."
                    }
                )
            }
            val payload = response.body() ?: throw IllegalStateException("The player database returned an empty response.")
            val list = payload.get("players")?.takeIf { it.isJsonArray }?.asJsonArray
                ?: throw IllegalStateException("The player database response was incomplete.")
            rows = list.mapNotNull { it.takeIf { value -> value.isJsonObject }?.asJsonObject }
            val banRows = payload.get("bans")?.takeIf { it.isJsonArray }?.asJsonArray
            bans = banRows?.mapNotNull { it.takeIf { value -> value.isJsonObject }?.asJsonObject }
                ?.associateBy { it.textValue("player_id") } ?: emptyMap()
            totalCount = payload.get("totalCount")?.takeIf { it.isJsonPrimitive }?.asInt ?: rows.size
            totalPages = (payload.get("totalPages")?.takeIf { it.isJsonPrimitive }?.asInt ?: 1).coerceAtLeast(1)
            page = targetPage.coerceIn(1, totalPages)
            if (rows.none { it.textValue("player_id") == selectedId }) selectedId = rows.firstOrNull()?.textValue("player_id").orEmpty()
        } catch (failure: Exception) {
            if (failure.message?.contains("restricted to the configured owner", ignoreCase = true) == true) accessDenied = true
            error = failure.message ?: "Could not load player records."
        } finally {
            loading = false
        }
    }

    suspend fun loadHistory(playerId: String) {
        if (playerId.isBlank()) { history = emptyList(); return }
        historyLoading = true
        try {
            container.repository.ensureOwnerSession()
            val response = container.api.adminPlayerHistory(playerId)
            if (!response.isSuccessful) throw IllegalStateException("Could not load player history (HTTP ${response.code()}).")
            val list = response.body()?.get("redemptions")?.takeIf { it.isJsonArray }?.asJsonArray
            history = list?.mapNotNull { it.takeIf { value -> value.isJsonObject }?.asJsonObject } ?: emptyList()
        } catch (failure: Exception) {
            error = failure.message ?: "Could not load redemption history."
        } finally {
            historyLoading = false
        }
    }

    suspend fun setRestriction(playerId: String, banned: Boolean) {
        busy = true
        error = null
        notice = null
        try {
            container.repository.ensureOwnerSession()
            val body = JsonObject().apply {
                addProperty("action", if (banned) "BAN_PLAYER" else "UNBAN_PLAYER")
                addProperty("playerId", playerId)
                if (banned) addProperty("reason", reason.trim().take(200))
            }
            val response = container.api.adminPlayerAction(body)
            if (!response.isSuccessful) {
                if (response.code() == 401 || response.code() == 403) accessDenied = true
                throw IllegalStateException(
                    when (response.code()) {
                        401 -> "The administrator session expired. Sign in again."
                        403 -> "This Discord account cannot change player restrictions."
                        else -> "Player update failed (HTTP ${response.code()})."
                    }
                )
            }
            notice = if (banned) "Player $playerId restricted. Registration and automatic redemption are blocked."
                else "Player $playerId restored. Registration and automatic redemption are enabled."
            load(page)
        } catch (failure: Exception) {
            error = failure.message ?: "Could not update the player."
        } finally {
            busy = false
        }
    }

    LaunchedEffect(Unit) { load(1) }
    val selected = rows.firstOrNull { it.textValue("player_id") == selectedId }
    val banned = bans.containsKey(selectedId) || selected?.booleanValue("enabled") == false

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(13.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Player administration", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Owner-only player records and registration controls.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            OutlinedButton(onClick = { scope.launch { load(page) } }, enabled = !loading && !busy) {
                Icon(Icons.Outlined.Refresh, contentDescription = "Refresh")
            }
        }
        if (accessDenied) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Icon(Icons.Outlined.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Text("Administrator access required", fontWeight = FontWeight.Bold)
                    Text("Player records are hidden unless the configured owner Discord account is verified by the production backend.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(onClick = onOpenAccount, modifier = Modifier.fillMaxWidth()) { Text("Open Discord account") }
                }
            }
        } else {
            OutlinedTextField(
                value = search, onValueChange = { search = it.take(80) },
                modifier = Modifier.fillMaxWidth(), singleLine = true,
                label = { Text("Search player ID, name or kingdom") },
                trailingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) }
            )
            Button(onClick = { scope.launch { load(1) } }, enabled = !loading && !busy, modifier = Modifier.fillMaxWidth()) {
                Text(if (loading) "Loading…" else "Search players")
            }
            Text("$totalCount registered player records · page $page of $totalPages",
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (loading && rows.isEmpty()) CircularProgressIndicator()
            rows.forEach { player ->
                val id = player.textValue("player_id")
                val isRestricted = bans.containsKey(id) || player.booleanValue("enabled").not()
                Card(
                    modifier = Modifier.fillMaxWidth().clickable { selectedId = id; scope.launch { loadHistory(id) } },
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = BorderStroke(
                        if (selectedId == id) 1.5.dp else 0.5.dp,
                        if (selectedId == id) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
                    )
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(player.textValue("player_name").ifBlank { "Player $id" },
                                modifier = Modifier.weight(1f), fontWeight = FontWeight.Bold)
                            Text(if (isRestricted) "RESTRICTED" else "ACTIVE",
                                color = if (isRestricted) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                        }
                        Text("ID $id · Kingdom ${player.textValue("kingdom_id").ifBlank { "—" }}",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Power ${player.textValue("power").ifBlank { "—" }}",
                            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (rows.isEmpty() && !loading) Text("No matching player records.",
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = { scope.launch { load(page - 1) } },
                    enabled = !loading && page > 1, modifier = Modifier.weight(1f)) { Text("Previous") }
                OutlinedButton(onClick = { scope.launch { load(page + 1) } },
                    enabled = !loading && page < totalPages, modifier = Modifier.weight(1f)) { Text("Next") }
            }
            if (selected != null) {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Text("Selected player", style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                        Text(selected.textValue("player_name").ifBlank { "Player $selectedId" },
                            style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text("Created: ${selected.textValue("created_at").ifBlank { "not recorded" }}",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        OutlinedButton(onClick = { scope.launch { loadHistory(selectedId) } },
                            enabled = !historyLoading, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Outlined.History, contentDescription = null)
                            Text(if (historyLoading) "Loading history…" else "Load redemption history",
                                modifier = Modifier.padding(start = 7.dp))
                        }
                        if (history.isNotEmpty()) {
                            history.take(10).forEach { item ->
                                Text("${item.textValue("gift_code")} · ${item.textValue("status")} · ${item.textValue("attempted_at")}",
                                    style = MaterialTheme.typography.bodySmall)
                            }
                        } else if (!historyLoading) Text("No history loaded.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (!banned) {
                            OutlinedTextField(value = reason, onValueChange = { reason = it.take(200) },
                                modifier = Modifier.fillMaxWidth(), label = { Text("Restriction reason") })
                            Button(onClick = { scope.launch { setRestriction(selectedId, true) } },
                                enabled = !busy && reason.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Outlined.Block, contentDescription = null)
                                Text("Restrict player", modifier = Modifier.padding(start = 8.dp))
                            }
                        } else {
                            Button(onClick = { scope.launch { setRestriction(selectedId, false) } },
                                enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Outlined.ShieldCheck, contentDescription = null)
                                Text("Restore player", modifier = Modifier.padding(start = 8.dp))
                            }
                        }
                    }
                }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        notice?.let { Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall) }
        Spacer(Modifier.padding(2.dp))
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back to Explore") }
    }
}
