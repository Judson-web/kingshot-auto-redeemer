package com.judson.kingshot.autoredeemer.features.maintenance

import com.google.gson.JsonObject
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
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
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
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

private data class MaintenanceSnapshot(
    val enabled: Boolean,
    val message: String,
    val endsAt: String?,
    val updatedAt: String?
)

@Composable
fun NativeMaintenanceScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onOpenAccount: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var snapshot by remember { mutableStateOf<MaintenanceSnapshot?>(null) }
    var message by remember { mutableStateOf("") }
    var endAt by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var accessDenied by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }

    fun JsonObject.textValue(key: String): String =
        get(key)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.asString.orEmpty()

    fun JsonObject.toSnapshot(): MaintenanceSnapshot? {
        val node = get("maintenance")?.takeIf { it.isJsonObject }?.asJsonObject ?: return null
        val enabled = node.get("maintenance_enabled")?.takeIf { it.isJsonPrimitive }?.asBoolean ?: return null
        return MaintenanceSnapshot(
            enabled = enabled,
            message = node.textValue("maintenance_message"),
            endsAt = node.textValue("ends_at").ifBlank { null },
            updatedAt = node.textValue("updated_at").ifBlank { null }
        )
    }

    fun toLocalDateTime(value: String?): String {
        if (value.isNullOrBlank()) return ""
        return runCatching {
            val instant = java.time.Instant.parse(value)
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm").format(
                LocalDateTime.ofInstant(instant, ZoneId.systemDefault())
            )
        }.getOrDefault("")
    }

    suspend fun load() {
        loading = true
        error = null
        accessDenied = false
        try {
            container.repository.ensureOwnerSession()
            val response = container.api.adminMaintenance()
            if (!response.isSuccessful) {
                val reason = when (response.code()) {
                    401 -> "Your administrator session has expired. Sign in again."
                    403 -> "This Discord account is not authorized to manage maintenance."
                    else -> "Could not load maintenance settings (HTTP ${response.code()})."
                }
                if (response.code() == 401 || response.code() == 403) accessDenied = true
                throw IllegalStateException(reason)
            }
            val next = response.body()?.toSnapshot()
                ?: throw IllegalStateException("The server returned an invalid maintenance state.")
            snapshot = next
            message = next.message
            endAt = toLocalDateTime(next.endsAt)
        } catch (failure: Exception) {
            if (failure.message?.contains("restricted to the configured owner", ignoreCase = true) == true) accessDenied = true
            error = failure.message ?: "Could not verify administrator access."
        } finally {
            loading = false
        }
    }

    suspend fun save(enabled: Boolean) {
        if (saving) return
        error = null
        notice = null
        val parsedEnd = if (enabled && endAt.isNotBlank()) {
            runCatching { LocalDateTime.parse(endAt) }.getOrNull()
        } else null
        if (enabled && endAt.isNotBlank() && parsedEnd == null) {
            error = "Use YYYY-MM-DDTHH:MM for the optional end time."
            return
        }
        val endInstant = parsedEnd?.atZone(ZoneId.systemDefault())?.toInstant()
        if (endInstant != null && !endInstant.isAfter(java.time.Instant.now())) {
            error = "Choose a future end time or leave it empty for indefinite maintenance."
            return
        }
        saving = true
        try {
            container.repository.ensureOwnerSession()
            val body = JsonObject().apply {
                addProperty("action", "SET_MAINTENANCE")
                addProperty("enabled", enabled)
                addProperty("message", message.trim().take(500))
                if (enabled && endInstant != null) addProperty("endsAt", endInstant.toString())
                else add("endsAt", com.google.gson.JsonNull.INSTANCE)
            }
            val response = container.api.updateAdminMaintenance(body)
            if (!response.isSuccessful) {
                if (response.code() == 401 || response.code() == 403) accessDenied = true
                throw IllegalStateException(
                    when (response.code()) {
                        401 -> "Your administrator session has expired. Sign in again."
                        403 -> "This Discord account is not authorized to change maintenance."
                        else -> "Maintenance update failed (HTTP ${response.code()})."
                    }
                )
            }
            val next = response.body()?.toSnapshot()
                ?: throw IllegalStateException("The server did not confirm the maintenance update.")
            snapshot = next
            message = next.message
            endAt = toLocalDateTime(next.endsAt)
            notice = if (enabled) "Maintenance mode enabled. The public site will display the maintenance notice."
                else "Maintenance mode disabled. The public site is available."
        } catch (failure: Exception) {
            error = failure.message ?: "Could not update maintenance settings."
        } finally {
            saving = false
        }
    }

    LaunchedEffect(Unit) { load() }
    val active = snapshot?.let {
        it.enabled && (it.endsAt.isNullOrBlank() || runCatching {
            java.time.Instant.parse(it.endsAt).isAfter(java.time.Instant.now())
        }.getOrDefault(false))
    } == true

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Maintenance mode", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Owner-only production controls. Every operation is verified by the backend.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            OutlinedButton(onClick = { scope.launch { load() } }, enabled = !loading && !saving) {
                Icon(Icons.Outlined.Refresh, contentDescription = "Refresh")
            }
        }
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (active) Icons.Outlined.Warning else Icons.Outlined.Shield,
                        contentDescription = null, tint = if (active) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                    Text(if (active) "PUBLIC SITE IN MAINTENANCE" else "PUBLIC SITE ONLINE",
                        modifier = Modifier.padding(start = 8.dp),
                        color = if (active) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Bold)
                }
                Text(if (active) "Visitors are currently seeing the maintenance screen."
                    else "Maintenance mode is not currently affecting the public site.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                snapshot?.updatedAt?.takeIf { it.isNotBlank() }?.let {
                    Text("Last updated: $it", style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (loading && snapshot == null) {
            CircularProgressIndicator()
            Text("Verifying the owner session and loading production state…",
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (accessDenied) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Icon(Icons.Outlined.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Text("Administrator access required", fontWeight = FontWeight.Bold)
                    Text("Sign in with the configured owner Discord account. Other user and developer roles cannot access these controls.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(onClick = onOpenAccount, modifier = Modifier.fillMaxWidth()) { Text("Open Discord account") }
                }
            }
        }
        if (snapshot != null && !accessDenied) {
            OutlinedTextField(
                value = message, onValueChange = { message = it.take(500) },
                modifier = Modifier.fillMaxWidth(), label = { Text("Visitor message") },
                supportingText = { Text("${message.length}/500 characters") }, minLines = 3
            )
            OutlinedTextField(
                value = endAt, onValueChange = { endAt = it.take(16) },
                modifier = Modifier.fillMaxWidth(), label = { Text("Automatic end time (optional)") },
                supportingText = { Text("Local time: YYYY-MM-DDTHH:MM. Leave blank for indefinite maintenance.") },
                singleLine = true
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = { scope.launch { save(false) } },
                    enabled = !saving && snapshot?.enabled == true, modifier = Modifier.weight(1f)) {
                    Text("Disable")
                }
                Button(onClick = { scope.launch { save(true) } },
                    enabled = !saving && snapshot?.enabled != true, modifier = Modifier.weight(1f)) {
                    Text(if (saving) "Saving…" else "Enable maintenance")
                }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        notice?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        Spacer(Modifier.padding(2.dp))
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back to Explore") }
    }
}
