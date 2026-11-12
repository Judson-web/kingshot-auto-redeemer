package com.judson.kingshot.autoredeemer

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.judson.kingshot.autoredeemer.data.ApiException
import com.judson.kingshot.autoredeemer.data.AppContainer
import com.judson.kingshot.autoredeemer.data.api.PendingRedemption
import com.judson.kingshot.autoredeemer.data.api.RedemptionRequest
import com.judson.kingshot.autoredeemer.data.api.RedemptionResult
import com.judson.kingshot.autoredeemer.data.api.PlayerProfile
import kotlinx.coroutines.launch
import java.util.UUID

private val Night = Color(0xFF0A100E)
private val Panel = Color(0xFF121C17)
private val PanelRaised = Color(0xFF19261F)
private val Mint = Color(0xFF7BE0A7)
private val Muted = Color(0xFF9BAEA3)
private val Ink = Color(0xFFEAF4ED)
private val Warning = Color(0xFFFFC875)
private val Danger = Color(0xFFFF8C8C)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = AppContainer(applicationContext)
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Mint,
                    onPrimary = Night,
                    background = Night,
                    onBackground = Ink,
                    surface = Panel,
                    onSurface = Ink,
                    surfaceVariant = PanelRaised,
                    onSurfaceVariant = Muted,
                    secondary = Color(0xFFB4D9C1),
                    error = Danger
                )
            ) {
                Surface(Modifier.fillMaxSize(), color = Night) {
                    RedeemerApp(container)
                }
            }
        }
    }
}

private enum class AppTab(val label: String) {
    HOME("Home"), REDEEM("Redeem"), PLAYERS("Players"), HISTORY("History"), SETTINGS("Settings")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RedeemerApp(container: AppContainer) {
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(AppTab.HOME) }
    var healthText by remember { mutableStateOf("Checking service…") }
    var serviceOnline by remember { mutableStateOf<Boolean?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var apiKeySet by remember { mutableStateOf(!container.secureStorage.read(AppContainer.API_KEY_STORAGE).isNullOrBlank()) }

    suspend fun refreshHealth() {
        refreshing = true
        try {
            val health = container.repository.health()
            serviceOnline = health.healthy == true
            healthText = health.status?.replaceFirstChar { it.uppercase() }
                ?: if (health.healthy == true) "Operational" else "Unavailable"
        } catch (error: Exception) {
            serviceOnline = false
            healthText = error.message ?: "Unable to reach service"
        } finally {
            refreshing = false
        }
    }

    LaunchedEffect(Unit) { refreshHealth() }

    Scaffold(
        containerColor = Night,
        topBar = {
            TopAppBar(
                title = {
                    Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Text("KINGS H O T", fontSize = 10.sp, color = Muted, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                        Text("Auto Redeemer", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
                    }
                },
                actions = {
                    IconButton(onClick = { tab = AppTab.SETTINGS }) {
                        Icon(Icons.Outlined.Settings, contentDescription = "Settings", tint = Muted)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Night)
            )
        },
        bottomBar = {
            NavigationBar(containerColor = Panel, contentColor = Ink) {
                val items = listOf(
                    Triple(AppTab.HOME, Icons.Outlined.Dashboard, "Home"),
                    Triple(AppTab.REDEEM, Icons.Outlined.Redeem, "Redeem"),
                    Triple(AppTab.PLAYERS, Icons.Outlined.Groups, "Players"),
                    Triple(AppTab.HISTORY, Icons.Outlined.History, "History")
                )
                items.forEach { (destination, icon, label) ->
                    NavigationBarItem(
                        selected = tab == destination,
                        onClick = { tab = destination },
                        icon = { Icon(icon, contentDescription = label) },
                        label = { Text(label, fontSize = 10.sp) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Mint,
                            selectedTextColor = Mint,
                            indicatorColor = PanelRaised,
                            unselectedIconColor = Muted,
                            unselectedTextColor = Muted
                        )
                    )
                }
            }
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (tab) {
                AppTab.HOME -> HomeScreen(
                    healthText, serviceOnline, apiKeySet, refreshing,
                    onRefresh = { scope.launch { refreshHealth() } },
                    onRedeem = { tab = AppTab.REDEEM },
                    onConfigure = { tab = AppTab.SETTINGS }
                )
                AppTab.REDEEM -> RedeemScreen(container)
                AppTab.PLAYERS -> PlayersScreen(container)
                AppTab.HISTORY -> HistoryScreen(container)
                AppTab.SETTINGS -> SettingsScreen(container, apiKeySet) {
                    apiKeySet = !container.secureStorage.read(AppContainer.API_KEY_STORAGE).isNullOrBlank()
                }
            }
        }
    }
}

@Composable
private fun ScreenColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        content = content
    )
}

@Composable
private fun HomeScreen(
    healthText: String,
    serviceOnline: Boolean?,
    apiKeySet: Boolean,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onRedeem: () -> Unit,
    onConfigure: () -> Unit
) {
    ScreenColumn {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("YOUR KINGDOM. YOUR REWARDS.", color = Mint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
            Text("Everything in one place.", color = Ink, fontSize = 32.sp, lineHeight = 36.sp, fontWeight = FontWeight.ExtraBold)
            Text("A faster way to keep your Kingshot rewards in reach.", color = Muted, fontSize = 14.sp)
        }
        Card(colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(22.dp)) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CloudDone, contentDescription = null, tint = if (serviceOnline == true) Mint else Warning)
                    Spacer(Modifier.width(9.dp))
                    Text("SERVICE STATUS", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                    Spacer(Modifier.weight(1f))
                    Text(if (serviceOnline == true) "LIVE" else if (serviceOnline == false) "CHECK" else "…", color = if (serviceOnline == true) Mint else Warning, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                Text(healthText, fontSize = 23.sp, fontWeight = FontWeight.Bold, color = Ink)
                Text("Connected to the existing production service.", color = Muted, fontSize = 12.sp)
                OutlinedButton(onClick = onRefresh, enabled = !refreshing, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Refresh, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (refreshing) "Checking…" else "Refresh status")
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricCard("API KEY", if (apiKeySet) "Configured" else "Not set", Icons.Outlined.Key, Modifier.weight(1f))
            MetricCard("REDEMPTION", "Server-side", Icons.Outlined.Bolt, Modifier.weight(1f))
        }
        Card(colors = CardDefaults.cardColors(containerColor = PanelRaised), shape = RoundedCornerShape(22.dp)) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Ready when you are", color = Ink, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text("Look up a player or submit a gift code through the official V4 API. The production workers remain in control of automatic redemption.", color = Muted, fontSize = 13.sp, lineHeight = 19.sp)
                Button(onClick = onRedeem, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = Night)) {
                    Icon(Icons.Outlined.Redeem, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Redeem a gift code", fontWeight = FontWeight.Bold)
                }
                if (!apiKeySet) TextButton(onClick = onConfigure) { Text("Configure Developer API key", color = Mint) }
            }
        }
        Text("Built for the community · Independent of Century Games", color = Muted, fontSize = 11.sp)
    }
}

@Composable
private fun MetricCard(title: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier = Modifier) {
    Card(modifier, colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, contentDescription = null, tint = Mint)
            Text(title, color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Text(value, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        }
    }
}

@Composable
private fun RedeemScreen(container: AppContainer) {
    val scope = rememberCoroutineScope()
    var playerId by remember { mutableStateOf("") }
    var kingdomId by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var successful by remember { mutableStateOf<Boolean?>(null) }
    var pending by remember { mutableStateOf(container.repository.pendingRedemption()) }

    ScreenColumn {
        ScreenHeading("Manual redemption", "Submit a gift code using the production V4 redemption endpoint.")
        if (pending != null) {
            NoticeCard(
                "An earlier attempt has an unresolved outcome. Retry only this exact request with its original idempotency key. Do not create a second redemption.",
                Warning
            )
        }
        OutlinedField("Player ID", playerId, { playerId = it.filter(Char::isDigit).take(20) }, enabled = pending == null, keyboardType = KeyboardType.Number)
        OutlinedField("Kingdom ID", kingdomId, { kingdomId = it.filter(Char::isDigit).take(10) }, enabled = pending == null, keyboardType = KeyboardType.Number)
        OutlinedField("Gift code", code, { code = it.uppercase().filter { ch -> ch.isLetterOrDigit() || ch == '_' || ch == '-' }.take(64) }, enabled = pending == null)
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    message = null
                    successful = null
                    val attempt = pending ?: PendingRedemption(
                        UUID.randomUUID().toString(),
                        RedemptionRequest(playerId.trim(), code.trim(), kingdomId.trim())
                    ).also {
                        container.repository.savePendingRedemption(it)
                        pending = it
                    }
                    try {
                        val result = container.repository.redeem(attempt)
                        container.repository.clearPendingRedemption()
                        pending = null
                        successful = result.ok == true
                        message = result.message ?: result.statusLabel ?: result.status ?: "Request processed."
                    } catch (error: Exception) {
                        val apiError = error as? ApiException
                        val definitiveFailure = apiError?.retryHint == "do_not_retry" ||
                            apiError?.status in listOf(400, 401, 404, 415)
                        if (definitiveFailure) {
                            container.repository.clearPendingRedemption()
                            pending = null
                        }
                        message = buildString {
                            append(error.message ?: "The outcome could not be confirmed. Retry this exact attempt.")
                            apiError?.requestId?.let { append("\nReference: ").append(it) }
                            if (definitiveFailure) append("\nCorrect the issue before submitting again.")
                        }
                        successful = false
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = !busy && (pending != null || (playerId.matches(Regex("\\d{5,20}") ) && kingdomId.matches(Regex("\\d{1,10}")) && code.matches(Regex("[A-Za-z0-9_-]{1,64}")))),
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = Night)
        ) {
            Icon(Icons.Outlined.Redeem, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(if (busy) "Processing…" else if (pending != null) "Retry same attempt" else "Redeem code", fontWeight = FontWeight.Bold)
        }
        message?.let { NoticeCard(it, if (successful == true) Mint else Warning) }
        Text("A successful API response does not guarantee that the game granted rewards. The result shown here reflects the upstream game response.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
    }
}

@Composable
private fun PlayersScreen(container: AppContainer) {
    val scope = rememberCoroutineScope()
    var playerId by remember { mutableStateOf("") }
    var kingdomId by remember { mutableStateOf("") }
    var playerName by remember { mutableStateOf("") }
    var profile by remember { mutableStateOf<PlayerProfile?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    ScreenColumn {
        ScreenHeading("Players", "Look up a profile or enroll a player in the existing automatic redemption workflow.")
        OutlinedField("Player ID", playerId, { playerId = it.filter(Char::isDigit).take(20) }, keyboardType = KeyboardType.Number)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = {
                scope.launch {
                    busy = true
                    message = null
                    try { profile = container.repository.lookup(playerId); message = "Player profile loaded." }
                    catch (error: Exception) { profile = null; message = error.message }
                    finally { busy = false }
                }
            }, enabled = !busy && playerId.matches(Regex("\\d{5,20}")), modifier = Modifier.weight(1f)) {
                Text(if (busy) "Please wait…" else "Look up")
            }
            OutlinedButton(onClick = {
                scope.launch {
                    busy = true
                    message = null
                    try {
                        message = container.repository.register(playerId, kingdomId, playerName)
                    } catch (error: Exception) { message = error.message }
                    finally { busy = false }
                }
            }, enabled = !busy && playerId.matches(Regex("\\d{5,20}")) && kingdomId.matches(Regex("\\d{1,10}")), modifier = Modifier.weight(1f)) {
                Text("Register")
            }
        }
        profile?.let { PlayerCard(it) }
        Divider(color = PanelRaised)
        Text("Automatic redemption enrollment", color = Ink, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Text("Registration enrolls the player in the existing server-side workflow. It does not run a redemption immediately.", color = Muted, fontSize = 12.sp)
        OutlinedField("Kingdom ID", kingdomId, { kingdomId = it.filter(Char::isDigit).take(10) }, keyboardType = KeyboardType.Number)
        OutlinedField("Player name (optional)", playerName, { playerName = it.take(120) })
        message?.let { NoticeCard(it, Mint) }
    }
}

@Composable
private fun PlayerCard(profile: PlayerProfile) {
    Card(colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(20.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(profile.name ?: "Unknown player", fontWeight = FontWeight.Bold, fontSize = 19.sp)
            Text("ID " + (profile.playerId ?: "—") + "  ·  Kingdom " + (profile.kingdomId ?: "—"), color = Muted, fontSize = 12.sp)
            Text("Power  " + (profile.power?.toString() ?: "—"), color = Ink, fontSize = 14.sp)
            Text("Town Center  " + (profile.townCenterLevel?.toString() ?: "—"), color = Ink, fontSize = 14.sp)
            Text("Alliance  " + (profile.allianceName ?: "—") + (profile.allianceTag?.let { " [$it]" } ?: ""), color = Ink, fontSize = 14.sp)
        }
    }
}

@Composable
private fun HistoryScreen(container: AppContainer) {
    val scope = rememberCoroutineScope()
    var playerId by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf(emptyList<com.judson.kingshot.autoredeemer.data.api.RedemptionHistoryItem>()) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    ScreenColumn {
        ScreenHeading("Redemption history", "Review stored outcomes. Reading history never submits a redemption.")
        OutlinedField("Player ID", playerId, { playerId = it.filter(Char::isDigit).take(20) }, keyboardType = KeyboardType.Number)
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    message = null
                    try { rows = container.repository.history(playerId); if (rows.isEmpty()) message = "No history records were returned." }
                    catch (error: Exception) { message = error.message }
                    finally { busy = false }
                }
            },
            enabled = !busy && playerId.matches(Regex("\\d{5,20}")),
            modifier = Modifier.fillMaxWidth()
        ) { Text(if (busy) "Loading…" else "Load history") }
        message?.let { NoticeCard(it, Warning) }
        rows.forEach { item ->
            Card(colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(16.dp)) {
                Column(Modifier.fillMaxWidth().padding(15.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(item.code, color = Ink, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Text(item.status, color = Mint, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                    Text(item.createdAt.ifBlank { "Date unavailable" }, color = Muted, fontSize = 11.sp)
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(container: AppContainer, apiKeySet: Boolean, onChanged: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    var key by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    ScreenColumn {
        ScreenHeading("Settings", "Connect your Developer API key. It is encrypted locally using Android Keystore.")
        OutlinedField("Developer API key", key, { key = it.trim() }, password = true)
        Button(
            onClick = {
                if (key.matches(Regex("ks_live_[a-f0-9]{64}"))) {
                    container.secureStorage.write(AppContainer.API_KEY_STORAGE, key)
                    key = ""
                    message = "Developer API key saved securely on this device."
                    onChanged()
                } else {
                    message = "That key does not match the expected V4 developer-key format."
                }
            },
            enabled = key.isNotBlank(),
            modifier = Modifier.fillMaxWidth()
        ) { Text("Save API key") }
        if (apiKeySet) {
            OutlinedButton(
                onClick = {
                    container.secureStorage.remove(AppContainer.API_KEY_STORAGE)
                    message = "Developer API key removed from this device."
                    onChanged()
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("Remove saved key") }
        }
        message?.let { NoticeCard(it, Mint) }
        Divider(color = PanelRaised)
        Text("Where to get a key", color = Ink, fontWeight = FontWeight.Bold)
        Text("Sign in with Discord on the official service website, open Developer API, and create a key. The app never embeds a shared key or asks for your Discord password.", color = Muted, fontSize = 13.sp, lineHeight = 19.sp)
        TextButton(onClick = { runCatching { uriHandler.openUri("https://app.ks-redeemer.workers.dev/developer") } }) {
            Icon(Icons.Outlined.OpenInNew, contentDescription = null, tint = Mint)
            Spacer(Modifier.width(8.dp))
            Text("Open Developer Portal", color = Mint)
        }
        Divider(color = PanelRaised)
        Text("App version 1.1.0 · Android", color = Muted, fontSize = 11.sp)
        Text("Production connection", color = Ink, fontWeight = FontWeight.Bold)
        Text(AppContainer.API_BASE_URL, color = Muted, fontSize = 12.sp)
        Text("Automatic redemption continues to run on the existing production workers. This app does not run background redemption jobs.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
    }
}

@Composable
private fun ScreenHeading(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontSize = 27.sp, color = Ink, fontWeight = FontWeight.ExtraBold)
        Text(subtitle, fontSize = 13.sp, color = Muted, lineHeight = 19.sp)
    }
}

@Composable
private fun OutlinedField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean = true,
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        enabled = enabled,
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Mint,
            focusedLabelColor = Mint,
            cursorColor = Mint,
            unfocusedBorderColor = PanelRaised
        )
    )
}

@Composable
private fun NoticeCard(message: String, accent: Color) {
    Card(colors = CardDefaults.cardColors(containerColor = PanelRaised), shape = RoundedCornerShape(15.dp)) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = accent)
            Spacer(Modifier.width(10.dp))
            Text(message, color = Ink, fontSize = 12.sp, lineHeight = 18.sp)
        }
    }
}
