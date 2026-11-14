package com.judson.kingshot.autoredeemer.features.giftcodes

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
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
fun GiftCodesScreen(container: AppContainer, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var codes by remember { mutableStateOf(emptyList<JsonObject>()) }
    var query by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var copiedCode by remember { mutableStateOf<String?>(null) }
    var refreshedAt by remember { mutableStateOf<String?>(null) }

    fun JsonObject.value(key: String): String =
        get(key)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.asString.orEmpty()

    suspend fun refresh() {
        loading = true
        error = null
        try {
            val response = container.repository.giftCodes()
            val rows = response.get("codes")?.takeIf { it.isJsonArray }?.asJsonArray
            codes = rows?.mapNotNull { it.takeIf { element -> element.isJsonObject }?.asJsonObject }
                ?.filter { it.value("code").matches(Regex("[A-Za-z0-9_-]{6,32}")) }
                ?: emptyList()
            refreshedAt = response.value("generatedAt")
        } catch (failure: Exception) {
            error = failure.message ?: "The verified code catalogue could not be loaded."
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { refresh() }

    val visibleCodes = codes.filter { it.value("code").contains(query.trim(), ignoreCase = true) }
    val surface = MaterialTheme.colorScheme.surface
    val accent = MaterialTheme.colorScheme.primary

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Gift code library", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Verified by the live service. Unverified or suppressed codes are not displayed.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = { scope.launch { refresh() } }, enabled = !loading) {
                if (loading) CircularProgressIndicator(strokeWidth = 2.dp)
                else Icon(Icons.Outlined.Refresh, contentDescription = "Refresh codes")
            }
        }

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            color = surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.CardGiftcard, contentDescription = null, tint = accent)
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("${codes.size} verified codes", fontWeight = FontWeight.SemiBold)
                    Text("Recent successful redemptions · last 7 days",
                        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text("LIVE", style = MaterialTheme.typography.labelSmall, color = accent, fontWeight = FontWeight.Bold)
            }
        }

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
            Row(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Search, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(10.dp))
                BasicTextField(
                    value = query,
                    onValueChange = { query = it.take(32) },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                    decorationBox = { inner ->
                        if (query.isEmpty()) Text("Search gift codes", color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium)
                        inner()
                    }
                )
            }
        }

        if (loading && codes.isEmpty()) {
            Column(modifier = Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator()
                Text("Loading verified codes…", modifier = Modifier.padding(top = 12.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else if (error != null && codes.isEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = surface)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Catalogue unavailable", fontWeight = FontWeight.Bold)
                    Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                    Button(onClick = { scope.launch { refresh() } }, enabled = !loading) { Text("Try again") }
                }
            }
        } else if (visibleCodes.isEmpty()) {
            Column(modifier = Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(if (codes.isEmpty()) "No active verified codes" else "No matching codes",
                    modifier = Modifier.padding(top = 10.dp), fontWeight = FontWeight.SemiBold)
                Text(if (codes.isEmpty()) "Check back later. The catalogue updates from the service."
                    else "Try another code or clear your search.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(visibleCodes, key = { it.value("code") }) { item ->
                    val code = item.value("code")
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = surface),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        shape = RoundedCornerShape(18.dp)
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(code, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold)
                                IconButton(onClick = {
                                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                    clipboard.setPrimaryClip(ClipData.newPlainText("Kingshot gift code", code))
                                    copiedCode = code
                                }) { Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy $code", tint = accent) }
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = accent)
                                Spacer(Modifier.width(6.dp))
                                Text("${item.value("recentSuccesses").ifBlank { "0" }} successful redemptions in 7 days",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text("Validated ${item.value("validatedAt").ifBlank { "date unavailable" }}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (copiedCode == code) Text("Copied to clipboard",
                                style = MaterialTheme.typography.labelSmall, color = accent)
                        }
                    }
                }
            }
        }

        if (refreshedAt != null) Text("Catalogue updated: $refreshedAt",
            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (error != null && codes.isNotEmpty()) Text(error.orEmpty(),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back to Explore") }
    }
}
