package com.judson.kingshot.autoredeemer.features.announcements

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.gson.JsonObject
import com.judson.kingshot.autoredeemer.data.AppContainer
import kotlinx.coroutines.launch

@Composable
fun AnnouncementsScreen(container: AppContainer, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var announcements by remember { mutableStateOf(emptyList<JsonObject>()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun JsonObject.textValue(key: String): String =
        get(key)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.asString.orEmpty()

    suspend fun refresh() {
        loading = true
        error = null
        try {
            val response = container.api.publicAnnouncements()
            if (!response.isSuccessful) throw IllegalStateException(
                when (response.code()) {
                    429 -> "Please wait a moment before refreshing announcements."
                    in 500..599 -> "The announcement service is temporarily unavailable."
                    else -> "Announcements could not be loaded (HTTP ${response.code()})."
                }
            )
            val payload = response.body() ?: throw IllegalStateException("The announcement service returned an empty response.")
            announcements = payload.get("announcements")?.takeIf { it.isJsonArray }?.asJsonArray
                ?.mapNotNull { it.takeIf { row -> row.isJsonObject }?.asJsonObject }
                ?.filter { it.textValue("title").isNotBlank() || it.textValue("message").isNotBlank() }
                ?.take(20) ?: emptyList()
        } catch (failure: Exception) {
            error = failure.message ?: "Announcements could not be loaded."
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { refresh() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Announcements", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Official service updates from the live website feed.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = { scope.launch { refresh() } }, enabled = !loading) {
                if (loading) CircularProgressIndicator(strokeWidth = 2.dp)
                else Icon(Icons.Outlined.Refresh, contentDescription = "Refresh announcements")
            }
        }
        if (loading && announcements.isEmpty()) {
            CircularProgressIndicator()
        } else if (error != null && announcements.isEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Feed unavailable", fontWeight = FontWeight.Bold)
                    Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                    Button(onClick = { scope.launch { refresh() } }, enabled = !loading) { Text("Try again") }
                }
            }
        } else if (announcements.isEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.Campaign, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text("You're all caught up", fontWeight = FontWeight.Bold)
                    Text("There are no active public announcements right now.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
            announcements.forEach { item ->
                val title = item.textValue("title").ifBlank { "Service announcement" }.take(140)
                val message = item.textValue("message").take(2400)
                val type = item.textValue("type").lowercase()
                val tint = when (type) {
                    "success" -> MaterialTheme.colorScheme.primary
                    "warning", "important" -> MaterialTheme.colorScheme.error
                    else -> MaterialTheme.colorScheme.secondary
                }
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Campaign, contentDescription = null, tint = tint)
                            Spacer(Modifier.width(9.dp))
                            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                                modifier = Modifier.weight(1f))
                        }
                        Text(message, style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        val link = item.textValue("link_url")
                        val uri = runCatching { Uri.parse(link) }.getOrNull()
                        if (uri?.scheme == "https" && !uri.host.isNullOrBlank()) {
                            OutlinedButton(onClick = {
                                context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                            }) {
                                Text(item.textValue("link_label").ifBlank { "Learn more" }.take(60))
                                Spacer(Modifier.width(7.dp))
                                Icon(Icons.Outlined.OpenInNew, contentDescription = null)
                            }
                        }
                    }
                }
            }
        }
        if (error != null && announcements.isNotEmpty()) {
            Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back to Explore") }
    }
}
