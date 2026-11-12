package com.judson.kingshot.autoredeemer

import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.judson.kingshot.autoredeemer.data.ApiException
import com.judson.kingshot.autoredeemer.data.AppContainer
import com.judson.kingshot.autoredeemer.data.api.PendingRedemption
import com.judson.kingshot.autoredeemer.data.api.RedemptionRequest
import com.judson.kingshot.autoredeemer.data.api.RedemptionResult
import com.judson.kingshot.autoredeemer.data.api.PlayerProfile
import com.judson.kingshot.autoredeemer.data.api.RegistrationOutcome
import com.judson.kingshot.autoredeemer.data.api.RedemptionHistoryItem
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID
import java.security.MessageDigest
import java.security.SecureRandom

private val Night = Color(0xFF07110D)
private val Panel = Color(0xFF101D17)
private val PanelRaised = Color(0xFF182820)
private val Mint = Color(0xFF83E3AD)
private val Muted = Color(0xFFA0B3A8)
private val Ink = Color(0xFFF0F7F2)
private val Warning = Color(0xFFFFC875)
private val Danger = Color(0xFFFF9292)
private val Border = Color(0xFF263A2F)

class MainActivity : ComponentActivity() {
    private var authCallback by mutableStateOf<String?>(null)
    private var authCallbackError by mutableStateOf<String?>(null)

    private fun readAuthCallback(data: Uri?) {
        val callback = data?.takeIf { it.scheme == "ksredeemer" && it.host == "discord-callback" }
        authCallback = callback?.getQueryParameter("code")
        authCallbackError = callback?.getQueryParameter("error")
            ?: callback?.getQueryParameter("error_description")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readAuthCallback(intent.data)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = AppContainer(applicationContext)
        readAuthCallback(intent.data)
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
                    secondary = Color(0xFFB8DCC6),
                    error = Danger
                )
            ) {
                Surface(Modifier.fillMaxSize(), color = Night) {
                    RedeemerApp(container, authCallback, authCallbackError) {
                        authCallback = null
                        authCallbackError = null
                    }
                }
            }
        }
    }
}

private enum class AppTab(val label: String) {
    HOME("Home"), REDEEM("Redeem"), PLAYERS("Players"), HISTORY("History"), ACCOUNT("Account")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RedeemerApp(container: AppContainer, authCode: String?, authError: String?, onAuthCodeConsumed: () -> Unit) {
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(AppTab.HOME) }
    var healthText by remember { mutableStateOf("Connecting to production…") }
    var serviceOnline by remember { mutableStateOf<Boolean?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var apiKeySet by remember {
        mutableStateOf(!container.secureStorage.read(AppContainer.API_KEY_STORAGE).isNullOrBlank())
    }

    suspend fun refreshHealth() {
        refreshing = true
        try {
            val health = container.repository.health()
            serviceOnline = health.healthy == true
            healthText = health.status?.replace('_', ' ')?.lowercase()
                ?.replaceFirstChar { it.uppercase() }
                ?: if (health.healthy == true) "Operational" else "Service needs attention"
        } catch (error: Exception) {
            serviceOnline = false
            healthText = error.message ?: "Unable to reach the service"
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
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                        Box(
                            Modifier.size(36.dp).background(
                                Brush.linearGradient(listOf(Mint, Color(0xFF3E9D70))),
                                RoundedCornerShape(12.dp)
                            ),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Outlined.Bolt, contentDescription = null, tint = Night, modifier = Modifier.size(22.dp))
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                            Text("KINGSHOT", fontSize = 9.sp, color = Muted, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                            Text("Auto Redeemer", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Ink)
                        }
                    }
                },
                actions = {
                    Surface(
                        color = if (serviceOnline == true) Color(0xFF173D2A) else PanelRaised,
                        shape = CircleShape,
                        modifier = Modifier.padding(end = 4.dp)
                    ) {
                        Row(
                            Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Box(
                                Modifier.size(7.dp).background(
                                    if (serviceOnline == true) Mint else if (serviceOnline == false) Warning else Muted,
                                    CircleShape
                                )
                            )
                            Text(
                                if (serviceOnline == true) "LIVE" else if (serviceOnline == false) "CHECK" else "LINKING",
                                color = if (serviceOnline == true) Mint else Muted,
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.7.sp
                            )
                        }
                    }
                    IconButton(onClick = { tab = AppTab.HOME; scope.launch { refreshHealth() } }) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "Refresh service status", tint = Muted)
                    }
                    IconButton(onClick = { tab = AppTab.ACCOUNT }) {
                        Icon(Icons.Outlined.AccountCircle, contentDescription = "Account and access", tint = Muted)
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
                    Triple(AppTab.HISTORY, Icons.Outlined.History, "History"),
                    Triple(AppTab.ACCOUNT, Icons.Outlined.AccountCircle, "Account")
                )
                items.forEach { (destination, icon, label) ->
                    NavigationBarItem(
                        selected = tab == destination,
                        onClick = { tab = destination },
                        icon = { Icon(icon, contentDescription = label) },
                        label = { Text(label, fontSize = 10.sp, fontWeight = FontWeight.SemiBold) },
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
                    onPlayers = { tab = AppTab.PLAYERS },
                    onSettings = { tab = AppTab.PLAYERS }
                )
                AppTab.REDEEM -> RedeemScreen(container)
                AppTab.PLAYERS -> PlayersScreen(container) {
                    apiKeySet = !container.secureStorage.read(AppContainer.API_KEY_STORAGE).isNullOrBlank()
                }
                AppTab.HISTORY -> HistoryScreen(container)
                AppTab.ACCOUNT -> AccountScreen(container, authCode, authError, onAuthCodeConsumed)
            }
        }
    }
}

@Composable
private fun ScreenColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize()
            .background(Brush.verticalGradient(listOf(Night, Color(0xFF0B1711), Night)))
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(17.dp),
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
    onPlayers: () -> Unit,
    onSettings: () -> Unit
) {
    ScreenColumn {
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("YOUR KINGDOM. YOUR REWARDS.", color = Mint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.7.sp)
            Text("Rewards,\nwithin reach.", color = Ink, fontSize = 36.sp, lineHeight = 39.sp, fontWeight = FontWeight.ExtraBold)
            Text("A cleaner command centre for your Kingshot account.", color = Muted, fontSize = 14.sp, lineHeight = 20.sp)
        }

        Card(
            colors = CardDefaults.cardColors(containerColor = Panel),
            shape = RoundedCornerShape(24.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Border)
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CloudDone, contentDescription = null, tint = if (serviceOnline == true) Mint else Warning)
                    Spacer(Modifier.width(9.dp))
                    Text("PRODUCTION API", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                    Spacer(Modifier.weight(1f))
                    Text(
                        if (serviceOnline == true) "OPERATIONAL" else if (serviceOnline == false) "ATTENTION" else "CONNECTING",
                        color = if (serviceOnline == true) Mint else Warning,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
                Text(healthText, fontSize = 23.sp, fontWeight = FontWeight.Bold, color = Ink)
                Text("Live connection to the Cloudflare service. Automatic redemption stays on the server.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
                OutlinedButton(
                    onClick = onRefresh,
                    enabled = !refreshing,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Mint)
                ) {
                    Icon(Icons.Outlined.Refresh, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (refreshing) "Checking service…" else "Refresh connection")
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricCard("DEVELOPER KEY", if (apiKeySet) "Connected" else "Not configured", Icons.Outlined.Key, Modifier.weight(1f))
            MetricCard("AUTO REDEEM", "Server-side", Icons.Outlined.Bolt, Modifier.weight(1f))
        }

        Card(
            colors = CardDefaults.cardColors(containerColor = PanelRaised),
            shape = RoundedCornerShape(24.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Border)
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Quick actions", color = Ink, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text("Use the official API for player lookups and manual gift-code redemption.", color = Muted, fontSize = 13.sp, lineHeight = 19.sp)
                Button(
                    onClick = onRedeem,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(15.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = Night)
                ) {
                    Icon(Icons.Outlined.Redeem, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Redeem a gift code", fontWeight = FontWeight.Bold)
                }
                OutlinedButton(
                    onClick = onPlayers,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(15.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink)
                ) {
                    Icon(Icons.Outlined.PersonSearch, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Find or register a player")
                }
                if (!apiKeySet) {
                    TextButton(onClick = onSettings) {
                        Text("Set up your Developer API key", color = Mint)
                    }
                }
            }
        }
        Text("Independent community service · Not affiliated with Century Games", color = Muted, fontSize = 10.sp)
    }
}

@Composable
private fun MetricCard(
    title: String,
    value: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier
) {
    Card(
        modifier,
        colors = CardDefaults.cardColors(containerColor = Panel),
        shape = RoundedCornerShape(19.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Border)
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, contentDescription = null, tint = Mint)
            Text(title, color = Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
            Text(value, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
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
    val hasDeveloperKey = !container.secureStorage.read(AppContainer.API_KEY_STORAGE).isNullOrBlank()
    var retryWaitSeconds by remember { mutableIntStateOf(0) }

    LaunchedEffect(retryWaitSeconds) {
        if (retryWaitSeconds > 0) {
            delay(1_000)
            retryWaitSeconds -= 1
        }
    }

    ScreenColumn {
        ScreenHeading("Manual redemption", "Send a single request through the production V4 API.")
        if (!hasDeveloperKey) {
            NoticeCard("A Developer API key is required for manual redemption. Add one in the Players tab before submitting a code.", Warning)
        }
        if (pending != null) {
            NoticeCard(
                "An earlier attempt is unresolved. The app has preserved its exact request and idempotency key. Only retry this same attempt.",
                Warning
            )
            Text("Request reference: " + pending!!.idempotencyKey.take(8) + "…", color = Muted, fontSize = 11.sp)
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
                        retryWaitSeconds = 0
                        successful = result.ok == true
                        message = result.message ?: result.statusLabel ?: result.status ?: "Request processed."
                    } catch (error: Exception) {
                        val apiError = error as? ApiException
                        val definitiveFailure = apiError?.retryHint == "do_not_retry" ||
                            (apiError?.retryHint == null && apiError?.status in listOf(400, 401, 404, 415))
                        if (definitiveFailure) {
                            container.repository.clearPendingRedemption()
                            pending = null
                        }
                        retryWaitSeconds = when {
                            apiError?.retryAfterSeconds != null -> apiError.retryAfterSeconds.coerceIn(1, 3600).toInt()
                            apiError?.retryHint == "bounded_backoff" -> 3
                            else -> 0
                        }
                        message = buildString {
                            append(error.message ?: "The outcome could not be confirmed.")
                            apiError?.requestId?.let { append("\nReference: ").append(it) }
                            if (definitiveFailure) append("\nFix the issue before starting another attempt.")
                            else append("\nThe original request is retained. Do not create a new redemption.")
                        }
                        successful = false
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = hasDeveloperKey && !busy && retryWaitSeconds == 0 &&
                (pending != null || (playerId.matches(Regex("\\d{5,20}")) &&
                    kingdomId.matches(Regex("\\d{1,10}")) &&
                    code.matches(Regex("[A-Za-z0-9_-]{1,64}")))),
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(15.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = Night)
        ) {
            Icon(Icons.Outlined.Redeem, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(
                when {
                    busy -> "Processing securely…"
                    retryWaitSeconds > 0 -> "Retry available in ${retryWaitSeconds}s"
                    pending != null -> "Retry same attempt"
                    else -> "Redeem code"
                },
                fontWeight = FontWeight.Bold
            )
        }
        message?.let { NoticeCard(it, if (successful == true) Mint else Warning) }
        Text(
            "An accepted API response is not a guarantee that the game granted rewards. The result shown here reflects the upstream game response.",
            color = Muted, fontSize = 12.sp, lineHeight = 18.sp
        )
    }
}

@Composable
private fun PlayersScreen(container: AppContainer, onApiKeyChanged: () -> Unit) {
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    var playerId by remember { mutableStateOf("") }
    var kingdomId by remember { mutableStateOf("") }
    var playerName by remember { mutableStateOf("") }
    var profile by remember { mutableStateOf<PlayerProfile?>(null) }
    var registration by remember { mutableStateOf<RegistrationOutcome?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var key by remember { mutableStateOf("") }
    var keySaved by remember { mutableStateOf(false) }
    var keyConfigured by remember {
        mutableStateOf(!container.secureStorage.read(AppContainer.API_KEY_STORAGE).isNullOrBlank())
    }

    ScreenColumn {
        ScreenHeading("Players", "Look up player profiles and enroll accounts in the existing server-side workflow.")
        OutlinedField("Player ID", playerId, { playerId = it.filter(Char::isDigit).take(20) }, keyboardType = KeyboardType.Number)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = {
                    scope.launch {
                        busy = true
                        message = null
                        registration = null
                        try {
                            profile = container.repository.lookup(playerId)
                            message = "Player profile loaded from the V4 API."
                        } catch (error: Exception) {
                            profile = null
                            message = error.message
                        } finally { busy = false }
                    }
                },
                enabled = !busy && keyConfigured && playerId.matches(Regex("\\d{5,20}")),
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(14.dp)
            ) { Text(if (busy) "Please wait…" else "Look up") }
            OutlinedButton(
                onClick = {
                    scope.launch {
                        busy = true
                        message = null
                        profile = null
                        try {
                            registration = container.repository.register(playerId, kingdomId, playerName)
                            message = registration?.message
                        } catch (error: Exception) {
                            registration = null
                            message = error.message
                        } finally { busy = false }
                    }
                },
                enabled = !busy && playerId.matches(Regex("\\d{5,20}")) &&
                    (kingdomId.isBlank() || kingdomId.matches(Regex("\\d{1,10}"))),
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(14.dp)
            ) { Text("Register") }
        }
        profile?.let { PlayerCard(it) }
        registration?.let { outcome ->
            Card(
                colors = CardDefaults.cardColors(containerColor = Panel),
                shape = RoundedCornerShape(18.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Border)
            ) {
                Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(if (outcome.alreadyRegistered) "Already enrolled" else "Registration accepted", color = Mint, fontWeight = FontWeight.Bold)
                    Text(outcome.message, color = Ink, fontSize = 13.sp, lineHeight = 18.sp)
                    Text("Status: " + (outcome.registrationStatus ?: "Confirmed"), color = Muted, fontSize = 11.sp)
                    Text(
                        "Kingdom verification: " + when (outcome.kingdomVerified) {
                            true -> "Verified"
                            false -> if (outcome.verificationPending == true) "Pending" else "Not confirmed"
                            null -> "Not reported"
                        },
                        color = if (outcome.kingdomVerified == true) Mint else Warning,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    outcome.verifiedKingdomId?.let { Text("Verified kingdom: $it", color = Muted, fontSize = 11.sp) }
                }
            }
        }
        Divider(color = Border)
        Text("Automatic redemption enrollment", color = Ink, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Text("Enrollment adds the player to the existing scheduled workflow. It does not force an immediate redemption. Kingdom ID is optional if you do not have it.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
        OutlinedField("Kingdom ID (optional)", kingdomId, { kingdomId = it.filter(Char::isDigit).take(10) }, keyboardType = KeyboardType.Number)
        OutlinedField("Player name (optional)", playerName, { playerName = it.take(120) })
        message?.takeIf { registration == null }?.let { NoticeCard(it, Warning) }

        Divider(color = Border)
        Text("Developer API key", color = Ink, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        Text("Create a key in the official Developer Portal. It is encrypted locally with Android Keystore and sent only to V4 API routes.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
        Text(
            if (keyConfigured) "A Developer API key is saved securely on this device."
            else "No key is saved yet. Player registration remains available without one.",
            color = if (keyConfigured) Mint else Warning,
            fontSize = 11.sp
        )
        OutlinedField("Paste Developer API key", key, { key = it.trim() }, password = true)
        Button(
            onClick = {
                if (key.matches(Regex("ks_live_[a-f0-9]{64}"))) {
                    runCatching {
                        container.secureStorage.write(AppContainer.API_KEY_STORAGE, key)
                    }.onSuccess {
                        key = ""
                        keySaved = true
                        keyConfigured = true
                        onApiKeyChanged()
                    }.onFailure {
                        message = it.message ?: "Could not securely save the key."
                    }
                } else {
                    message = "That key does not match the expected V4 developer-key format."
                }
            },
            enabled = key.isNotBlank() && !busy,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp)
        ) { Text("Save key securely") }
        if (keySaved) Text("Developer key saved on this device.", color = Mint, fontSize = 12.sp)
        if (keyConfigured) {
            OutlinedButton(
                onClick = {
                    runCatching { container.secureStorage.remove(AppContainer.API_KEY_STORAGE) }
                       .onSuccess { keySaved = false; keyConfigured = false; onApiKeyChanged(); message = "Saved key removed from this device." }
                        .onFailure { message = it.message ?: "Could not remove the saved key." }
                },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp)
            ) { Text("Remove saved key") }
        }
        TextButton(onClick = { runCatching { uriHandler.openUri("https://app.ks-redeemer.workers.dev/developer") } }) {
            Icon(Icons.Outlined.OpenInNew, contentDescription = null, tint = Mint)
            Spacer(Modifier.width(8.dp))
            Text("Open Developer Portal", color = Mint)
        }
    }
}

@Composable
private fun PlayerCard(profile: PlayerProfile) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Panel),
        shape = RoundedCornerShape(20.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Border)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(profile.name ?: "Unknown player", fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Ink)
            Text("ID " + (profile.playerId ?: "—") + "  ·  Kingdom " + (profile.kingdomId ?: "—"), color = Muted, fontSize = 12.sp)
            Divider(color = Border)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ProfileMetric("POWER", profile.power?.let { "%,d".format(it) } ?: "—", Modifier.weight(1f))
                ProfileMetric("TOWN CENTER", profile.townCenterLevel?.toString() ?: "—", Modifier.weight(1f))
            }
            Text(
                "Alliance  " + (profile.allianceName ?: "—") + (profile.allianceTag?.let { " [$it]" } ?: ""),
                color = Ink, fontSize = 13.sp
            )
        }
    }
}

@Composable
private fun ProfileMetric(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(label, color = Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)
        Text(value, color = Ink, fontSize = 16.sp, fontWeight = FontWeight.Bold)
    }
}


@Composable
private fun AccountScreen(container: AppContainer, authCode: String?, authError: String?, onAuthCodeConsumed: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(true) }
    var profile by remember { mutableStateOf<com.google.gson.JsonObject?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun refreshProfile(): com.google.gson.JsonObject? {
        checking = true
        return try {
            val result = container.repository.discordProfile()
            val verified = result.takeIf { it.get("authenticated")?.asBoolean == true }
            profile = verified
            if (verified == null) message = "Connect Discord to securely link your account."
            error = null
            verified
        } catch (e: Exception) {
            error = e.message ?: "We couldn't verify your account. Check your connection and retry."
            null
        } finally {
            checking = false
        }
    }

    LaunchedEffect(Unit) {
        if (authCode.isNullOrBlank() && authError.isNullOrBlank()) refreshProfile()
    }

    LaunchedEffect(authCode, authError) {
        if (authCode.isNullOrBlank() && authError.isNullOrBlank()) return@LaunchedEffect
        val callbackError = authError?.take(300)
        if (!callbackError.isNullOrBlank()) {
            error = if (callbackError.contains("access_denied", true) ||
                callbackError.contains("cancel", true)) "Sign-in was cancelled. You can try again whenever you're ready."
                else "Discord sign-in could not be completed. $callbackError"
            message = null
            runCatching { container.secureStorage.remove(AppContainer.DISCORD_PKCE_STORAGE) }
            onAuthCodeConsumed()
            return@LaunchedEffect
        }
        val code = authCode
        if (code.isNullOrBlank()) return@LaunchedEffect
        busy = true
        checking = false
        error = null
        message = "Verifying your Discord identity securely…"
        try {
            val verifier = container.secureStorage.read(AppContainer.DISCORD_PKCE_STORAGE)
                ?: throw IllegalStateException("This sign-in attempt expired. Please connect Discord again.")
            val exchange = container.repository.completeDiscordSignIn(code, verifier)
            if (exchange.get("ok")?.asBoolean != true) {
                throw IllegalStateException(exchange.get("error")?.asString ?: "Discord could not verify this sign-in.")
            }
            container.secureStorage.remove(AppContainer.DISCORD_PKCE_STORAGE)
            val verified = refreshProfile()
            if (verified == null) throw IllegalStateException("Discord signed in, but the account session could not be verified. Please retry.")
            message = "Discord connected. Your permissions are verified by the production service."
        } catch (e: Exception) {
            error = e.message ?: "Discord sign-in could not be completed. Please try again."
            runCatching { container.secureStorage.remove(AppContainer.DISCORD_PKCE_STORAGE) }
        } finally {
            busy = false
            onAuthCodeConsumed()
        }
    }

    val user = profile?.getAsJsonObject("user")
    val role = profile?.get("role")?.takeUnless { it.isJsonNull }?.asString
        ?: user?.get("role")?.takeUnless { it.isJsonNull }?.asString
        ?: "user"
    val displayName = user?.get("display_name")?.takeUnless { it.isJsonNull }?.asString
        ?: user?.get("username")?.takeUnless { it.isJsonNull }?.asString
        ?: "Discord member"
    val discordName = user?.get("discord_username")?.takeUnless { it.isJsonNull }?.asString
    val roleLabel = when (role) {
        "admin" -> "PROJECT ADMIN"
        "developer" -> "DEVELOPER"
        else -> "STANDARD MEMBER"
    }

    ScreenColumn {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("ACCOUNT / IDENTITY", color = Mint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp)
                Text("Your account", fontSize = 28.sp, color = Ink, fontWeight = FontWeight.ExtraBold)
                Text("One Discord identity. Permissions verified server-side.", fontSize = 12.sp, color = Muted, lineHeight = 17.sp)
            }
            Surface(
                shape = RoundedCornerShape(50),
                color = if (profile != null) Color(0xFF153A29) else PanelRaised,
                border = androidx.compose.foundation.BorderStroke(1.dp, if (profile != null) Mint.copy(alpha = 0.4f) else Border)
            ) {
                Row(Modifier.padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(7.dp).background(if (checking) Warning else if (profile != null) Mint else Muted, CircleShape))
                    Text(
                        when { checking -> "CHECKING"; profile != null -> "VERIFIED"; else -> "GUEST" },
                        color = if (profile != null) Mint else Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        Card(
            colors = CardDefaults.cardColors(containerColor = Panel),
            shape = RoundedCornerShape(23.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Border)
        ) {
            Column(Modifier.fillMaxWidth().padding(17.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
                if (checking && profile == null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        CircularProgressIndicator(Modifier.size(25.dp), color = Mint, strokeWidth = 2.dp)
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text("Checking account session", color = Ink, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            Text("Contacting the secure account service.", color = Muted, fontSize = 12.sp)
                        }
                    }
                } else if (profile == null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(
                            Modifier.size(46.dp).background(
                                Brush.linearGradient(listOf(Mint.copy(alpha = 0.25f), Color(0xFF1B4432))),
                                RoundedCornerShape(15.dp)
                            ),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Outlined.AccountCircle, contentDescription = null, tint = Mint, modifier = Modifier.size(28.dp))
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text("Link your Discord", color = Ink, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            Text("Secure OAuth · No password stored", color = Muted, fontSize = 11.sp)
                        }
                    }
                    Text(
                        "Sign in with Discord to link your identity. Your access level is looked up from the verified account, never selected on this device.",
                        color = Muted, fontSize = 12.sp, lineHeight = 18.sp
                    )
                    Button(
                        onClick = {
                            scope.launch {
                                busy = true
                                error = null
                                message = null
                                try {
                                    val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
                                    val verifier = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
                                    val challenge = Base64.encodeToString(
                                        MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),
                                        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
                                    )
                                    container.secureStorage.write(AppContainer.DISCORD_PKCE_STORAGE, verifier)
                                    val url = container.repository.startDiscordSignIn(challenge)
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                                    message = "Continue in Discord. You'll return here automatically."
                                } catch (e: Exception) {
                                    error = e.message ?: "Could not start Discord sign-in. Please retry."
                                    runCatching { container.secureStorage.remove(AppContainer.DISCORD_PKCE_STORAGE) }
                                } finally {
                                    busy = false
                                }
                            }
                        },
                        enabled = !busy && !checking,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(15.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = Night)
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = Night, strokeWidth = 2.dp)
                        else Icon(Icons.Outlined.Chat, contentDescription = null)
                        Spacer(Modifier.width(9.dp))
                        Text(if (busy) "Preparing secure sign-in…" else "Continue with Discord", fontWeight = FontWeight.Bold)
                    }
                    Text("Discord handles your password and authorization. The app receives only a one-time code.",
                        color = Muted, fontSize = 10.sp, lineHeight = 15.sp)
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(
                            Modifier.size(50.dp).background(Brush.linearGradient(listOf(Mint, Color(0xFF3E9D70))), CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Outlined.AccountCircle, contentDescription = null, tint = Night, modifier = Modifier.size(32.dp))
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(displayName, color = Ink, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            Text(discordName?.let { "@$it" } ?: "Discord identity connected", color = Muted, fontSize = 11.sp)
                        }
                        Icon(Icons.Outlined.VerifiedUser, contentDescription = "Verified account", tint = Mint, modifier = Modifier.size(23.dp))
                    }
                    Divider(color = Border)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Surface(color = Color(0xFF173D2A), shape = RoundedCornerShape(8.dp)) {
                            Text(roleLabel, Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                color = Mint, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                        }
                        Text("Verified by production backend", color = Muted, fontSize = 10.sp)
                    }
                    Text(
                        when (role) {
                            "admin" -> "Owner permissions are active for this verified Discord identity."
                            "developer" -> "Developer access is active. API-key permissions remain controlled by the service."
                            else -> "Your personal account is connected. Developer access is separate and requires an active API key."
                        },
                        color = Muted, fontSize = 12.sp, lineHeight = 18.sp
                    )
                    OutlinedButton(
                        onClick = {
                            scope.launch {
                                busy = true
                                error = null
                                try {
                                    container.repository.discordLogout()
                                    profile = null
                                    message = "You have been securely signed out."
                                } catch (e: Exception) {
                                    error = e.message ?: "Sign-out could not be confirmed. Please retry."
                                } finally {
                                    busy = false
                                }
                            }
                        },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(46.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink)
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.size(16.dp), color = Mint, strokeWidth = 2.dp)
                        else Icon(Icons.Outlined.Logout, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (busy) "Signing out…" else "Sign out")
                    }
                }
            }
        }

        if (role == "admin" && profile != null) {
            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Text("OWNER CONTROL", color = Mint, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.4.sp)
                Text("Administration", color = Ink, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                Text("Restricted tools. Every destination checks your server-side owner session.", color = Muted, fontSize = 11.sp, lineHeight = 16.sp)
                AdminActionRow("Player database", "Player records and redemption activity", Icons.Outlined.Groups) {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://app.ks-redeemer.workers.dev/admin/players")))
                }
                AdminActionRow("Alliance sync", "Registered alliance sync configurations", Icons.Outlined.Sync) {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://app.ks-redeemer.workers.dev/admin/alliance-sync")))
                }
                AdminActionRow("Maintenance", "Service maintenance controls", Icons.Outlined.Build) {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://app.ks-redeemer.workers.dev/admin/maintenance")))
                }
                AdminActionRow("Support centre", "Review and respond to support requests", Icons.Outlined.SupportAgent) {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://app.ks-redeemer.workers.dev/devsupport")))
                }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.Shield, contentDescription = null, tint = Mint, modifier = Modifier.size(17.dp))
            Text("Your role is checked by the backend. This app cannot grant itself administrator access.",
                color = Muted, fontSize = 10.sp, lineHeight = 15.sp)
        }
        message?.let { Text(it, color = Mint, fontSize = 11.sp, lineHeight = 16.sp) }
        error?.let { NoticeCard(it, Danger) }
        if (!checking && profile == null) {
            TextButton(onClick = { scope.launch { refreshProfile() } }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Icon(Icons.Outlined.Refresh, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text("Retry account check", color = Mint)
            }
        }
    }
}

@Composable
private fun AdminActionRow(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit
) {
    Surface(onClick = onClick, color = PanelRaised, shape = RoundedCornerShape(15.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Border), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = Mint)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(subtitle, color = Muted, fontSize = 11.sp)
            }
            Icon(Icons.Outlined.OpenInNew, contentDescription = null, tint = Muted)
        }
    }
}

@Composable
private fun HistoryScreen(container: AppContainer) {
    val scope = rememberCoroutineScope()
    var playerId by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf(emptyList<RedemptionHistoryItem>()) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val hasDeveloperKey = !container.secureStorage.read(AppContainer.API_KEY_STORAGE).isNullOrBlank()
    ScreenColumn {
        ScreenHeading("Redemption history", "Review recorded outcomes. Reading history never submits a redemption.")
        if (!hasDeveloperKey) {
            NoticeCard("A Developer API key with redemption-history access is required. Add one in the Players tab.", Warning)
        }
        OutlinedField("Player ID", playerId, { playerId = it.filter(Char::isDigit).take(20) }, keyboardType = KeyboardType.Number)
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    message = null
                    try {
                        rows = container.repository.history(playerId)
                        if (rows.isEmpty()) message = "No history records were returned for this player."
                    } catch (error: Exception) {
                        rows = emptyList()
                        message = error.message
                    } finally { busy = false }
                }
            },
            enabled = !busy && hasDeveloperKey && playerId.matches(Regex("\\d{5,20}")),
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp)
        ) { Text(if (busy) "Loading history…" else "Load history") }
        message?.let { NoticeCard(it, Warning) }
        rows.forEach { item ->
            Card(
                colors = CardDefaults.cardColors(containerColor = Panel),
                shape = RoundedCornerShape(17.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Border)
            ) {
                Column(Modifier.fillMaxWidth().padding(15.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(item.code, color = Ink, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Text(item.status.replace('_', ' '), color = Mint, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                    Text(item.createdAt.ifBlank { "Date unavailable" }, color = Muted, fontSize = 11.sp)
                    item.message?.takeIf(String::isNotBlank)?.let {
                        Text(it, color = Muted, fontSize = 12.sp, lineHeight = 17.sp)
                    }
                    item.errorCode?.takeIf(String::isNotBlank)?.let {
                        Text("Code: $it", color = Warning, fontSize = 10.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun ScreenHeading(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontSize = 28.sp, color = Ink, fontWeight = FontWeight.ExtraBold)
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
        shape = RoundedCornerShape(14.dp),
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Mint,
            focusedLabelColor = Mint,
            cursorColor = Mint,
            unfocusedBorderColor = Border,
            unfocusedLabelColor = Muted
        )
    )
}

@Composable
private fun NoticeCard(message: String, accent: Color) {
    Card(
        colors = CardDefaults.cardColors(containerColor = PanelRaised),
        shape = RoundedCornerShape(16.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, accent.copy(alpha = 0.25f))
    ) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = accent)
            Spacer(Modifier.width(10.dp))
            Text(message, color = Ink, fontSize = 12.sp, lineHeight = 18.sp)
        }
    }
}
