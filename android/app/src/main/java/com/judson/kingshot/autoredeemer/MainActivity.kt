package com.judson.kingshot.autoredeemer

import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
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
    HOME("Home"), REDEEM("Redeem"), PLAYERS("Players"), HISTORY("History"), ACCOUNT("Account"), MORE("More"), KEYS("Developer API")
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
    var nativeFeature by remember { mutableStateOf<String?>(null) }

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
                    Triple(AppTab.MORE, Icons.Outlined.Explore, "Explore")
                )
                items.forEach { (destination, icon, label) ->
                    NavigationBarItem(
                        selected = tab == destination,
                        onClick = { tab = destination; if (destination == AppTab.MORE) nativeFeature = null },
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
                    healthText = healthText,
                    serviceOnline = serviceOnline,
                    apiKeySet = apiKeySet,
                    refreshing = refreshing,
                    onRefresh = { scope.launch { refreshHealth() } },
                    onRedeem = { tab = AppTab.REDEEM },
                    onPlayers = { tab = AppTab.PLAYERS },
                    onSettings = { tab = AppTab.KEYS }
                )
                AppTab.REDEEM -> RedeemScreen(container)
                AppTab.PLAYERS -> PlayersScreen(container) {
                    apiKeySet = !container.secureStorage.read(AppContainer.API_KEY_STORAGE).isNullOrBlank()
                }
                AppTab.HISTORY -> HistoryScreen(container)
                AppTab.ACCOUNT -> AccountScreen(container, authCode, authError, onAuthCodeConsumed)
                AppTab.MORE -> if (nativeFeature == null) MoreScreen(
                    onNavigate = { nativeFeature = it },
                    onOpenDeveloperKeys = { tab = AppTab.KEYS },
                    onOpenApiHistory = { tab = AppTab.HISTORY }
                ) else if (nativeFeature == "/alliance-registration") AllianceRegistrationScreen(container) { nativeFeature = null }
                else if (nativeFeature == "/gift-codes") GiftCodesScreen(container) { nativeFeature = null }
                else if (nativeFeature == "/user") PlayersScreen(container) { nativeFeature = null }
                else if (nativeFeature == "/profile") AccountScreen(container, authCode, authError, onAuthCodeConsumed)
                else if (nativeFeature == "/developer") DeveloperApiSettings(container) { nativeFeature = null }
                else if (nativeFeature == "/info") InfoScreen { nativeFeature = null }
                else NativeFeatureScreen(nativeFeature!!) { nativeFeature = null }
                AppTab.KEYS -> DeveloperApiSettings(container) { tab = AppTab.MORE }
            }
        }
    }
}


private data class OfficialFeature(
    val title: String,
    val description: String,
    val route: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val group: String
)

@Composable
private fun MoreScreen(
    onNavigate: (String) -> Unit,
    onOpenDeveloperKeys: () -> Unit,
    onOpenApiHistory: () -> Unit
) {
    val features = listOf(
        OfficialFeature("Alliance registration", "Register and review alliance members with the official sync workflow.", "/alliance-registration", Icons.Outlined.Groups, "KINGDOM TOOLS"),
        OfficialFeature("Gift codes", "Browse current and previously published gift codes.", "/gift-codes", Icons.Outlined.CardGiftcard, "KINGDOM TOOLS"),
        OfficialFeature("Player profiles", "Open the full player profile and lookup experience.", "/user", Icons.Outlined.PersonSearch, "KINGDOM TOOLS"),
        OfficialFeature("Service information", "How the service works, status guidance and documentation.", "/info", Icons.Outlined.Info, "RESOURCES"),
        OfficialFeature("Discord account", "Manage your verified account and access level.", "/profile", Icons.Outlined.AccountCircle, "ACCOUNT"),
        OfficialFeature("Developer portal", "Optional API keys, documentation, usage and integrations.", "/developer", Icons.Outlined.Code, "DEVELOPER"),
        OfficialFeature("Developer workspace", "Private developer tools and workspace.", "/dev", Icons.Outlined.Terminal, "DEVELOPER"),
        OfficialFeature("Developer support", "Technical support and developer assistance.", "/devsupport", Icons.Outlined.SupportAgent, "SUPPORT"),
        OfficialFeature("Push console", "Notification tools and delivery controls.", "/push", Icons.Outlined.Notifications, "ADMINISTRATION"),
        OfficialFeature("Custom message", "Manage the official Discord message experience.", "/message", Icons.Outlined.Message, "ADMINISTRATION"),
        OfficialFeature("Player administration", "Administrative player and registration controls.", "/admin/players", Icons.Outlined.ManageAccounts, "ADMINISTRATION"),
        OfficialFeature("Alliance sync", "Manage alliance synchronization and registration queues.", "/admin/alliance-sync", Icons.Outlined.Sync, "ADMINISTRATION"),
        OfficialFeature("Maintenance", "Service maintenance and operational controls.", "/admin/maintenance", Icons.Outlined.Build, "ADMINISTRATION")
    )
    ScreenColumn {
        ScreenHeading("Explore", "The complete official Kingshot Redeemer experience, connected to the same live backend as the website.")
        Card(
            colors = CardDefaults.cardColors(containerColor = PanelRaised),
            shape = RoundedCornerShape(22.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Border)
        ) {
            Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("OFFICIAL WEB EXPERIENCE", color = Mint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
                Text("Every tool. One app.", color = Ink, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text("These screens use the production website and its existing permission checks. Your app does not need a Developer API key for normal use.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
            }
        }
        features.groupBy { it.group }.forEach { (group, items) ->
            Text(group, color = Mint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
            items.forEach { feature ->
                Card(
                    onClick = { onNavigate(feature.route) },
                    colors = CardDefaults.cardColors(containerColor = Panel),
                    shape = RoundedCornerShape(17.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Border)
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(13.dp)
                    ) {
                        Box(
                            Modifier.size(42.dp).background(PanelRaised, RoundedCornerShape(13.dp)),
                            contentAlignment = Alignment.Center
                        ) { Icon(feature.icon, contentDescription = null, tint = Mint) }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(feature.title, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                            Text(feature.description, color = Muted, fontSize = 11.sp, lineHeight = 16.sp)
                        }
                        Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = Muted)
                    }
                }
            }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = Panel),
            shape = RoundedCornerShape(17.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Border)
        ) {
            Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("Optional V4 redemption history", color = Ink, fontWeight = FontWeight.Bold)
                Text("History through the public V4 Developer API is an optional advanced feature and requires a Developer API key. It is not needed for automatic or manual redemption.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
                OutlinedButton(onClick = onOpenApiHistory, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.History, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Open V4 history")
                }
            }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = Panel),
            shape = RoundedCornerShape(17.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Border)
        ) {
            Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("Optional Developer API", color = Ink, fontWeight = FontWeight.Bold)
                Text("A personal API key is only needed when you choose to call the public V4 Developer API from external tools. It is not required for the app's normal workflows.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
                OutlinedButton(onClick = onOpenDeveloperKeys, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Key, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Manage optional API key")
                }
            }
        }
        Text("Independent community service · Not affiliated with Century Games", color = Muted, fontSize = 10.sp)
    }
}


@Composable
private fun DeveloperApiSettings(container: AppContainer, onBack: () -> Unit) {
    var key by remember { mutableStateOf("") }
    var configured by remember { mutableStateOf(!container.secureStorage.read(AppContainer.API_KEY_STORAGE).isNullOrBlank()) }
    var message by remember { mutableStateOf<String?>(null) }
    ScreenColumn {
        ScreenHeading("Developer API", "Optional integration for external tools. The official app works without this key.")
        Card(
            colors = CardDefaults.cardColors(containerColor = Panel),
            shape = RoundedCornerShape(20.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Border)
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.Key, contentDescription = null, tint = Mint)
                    Text(if (configured) "Key stored securely on this device" else "No key configured", color = Ink, fontWeight = FontWeight.SemiBold)
                }
                Text("This key is only attached to /api/v4 requests made by optional developer integrations. It is not used for the app's official website workspace, Discord account, registration or normal redemption flows.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
                OutlinedField("Paste Developer API key", key, { key = it.trim() }, password = true)
                Button(
                    onClick = {
                        if (key.matches(Regex("ks_live_[a-f0-9]{64}"))) {
                            runCatching { container.secureStorage.write(AppContainer.API_KEY_STORAGE, key) }
                                .onSuccess { key = ""; configured = true; message = "Developer API key saved securely." }
                                .onFailure { message = it.message ?: "Could not save the key securely." }
                        } else message = "The key format is not valid."
                    },
                    enabled = key.isNotBlank(),
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Save optional key") }
                if (configured) OutlinedButton(
                    onClick = {
                        runCatching { container.secureStorage.remove(AppContainer.API_KEY_STORAGE) }
                            .onSuccess { configured = false; message = "Saved key removed from this device." }
                            .onFailure { message = it.message ?: "Could not remove the key." }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Remove key") }
                message?.let { Text(it, color = Mint, fontSize = 12.sp) }
            }
        }
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back to Explore") }
    }
}


@Composable
private fun AllianceRegistrationScreen(container: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var kingdom by remember { mutableStateOf("") }
    var search by remember { mutableStateOf("") }
    var alliances by remember { mutableStateOf(emptyList<com.google.gson.JsonObject>()) }
    var selectedTag by remember { mutableStateOf("") }
    var roster by remember { mutableStateOf(emptyList<com.google.gson.JsonObject>()) }
    var registered by remember { mutableStateOf<Set<String>>(emptySet()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var registrationAllowed by remember { mutableStateOf(false) }
    fun com.google.gson.JsonObject.str(key: String): String =
        get(key)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.asString.orEmpty()

    ScreenColumn {
        ScreenHeading("Alliance registration", "Find your kingdom alliance, review its roster and register its existing 24-hour sync workflow.")
        OutlinedField("Kingdom ID", kingdom, { kingdom = it.filter(Char::isDigit).take(10) }, keyboardType = KeyboardType.Number)
        OutlinedField("Search alliance name or tag", search, { search = it.take(80) })
        Button(
            onClick = {
                scope.launch {
                    busy = true; error = null; notice = null; alliances = emptyList(); roster = emptyList(); selectedTag = ""
                    try {
                        val result = container.repository.searchAlliances(kingdom, search)
                        val list = result.get("alliances")?.takeIf { it.isJsonArray }?.asJsonArray
                        alliances = list?.mapNotNull { it.takeIf { item -> item.isJsonObject }?.asJsonObject } ?: emptyList()
                        if (alliances.isEmpty()) notice = "No alliances were returned. Check the kingdom ID or search term."
                    } catch (e: Exception) { error = e.message ?: "Alliance search failed." }
                    finally { busy = false }
                }
            },
            enabled = !busy && kingdom.matches(Regex("\\d{1,10}")),
            modifier = Modifier.fillMaxWidth()
        ) { Text(if (busy) "Searching…" else "Find alliances") }
        alliances.forEach { alliance ->
            val tag = alliance.str("tag")
            Card(
                onClick = {
                    scope.launch {
                        selectedTag = tag; busy = true; error = null; notice = null; roster = emptyList(); registered = emptySet()
                        try {
                            val result = container.repository.allianceRoster(kingdom, tag)
                            if (result.get("stale")?.takeIf { it.isJsonPrimitive }?.asBoolean == true ||
                                result.get("fresh")?.takeIf { it.isJsonPrimitive }?.asBoolean == false) {
                                throw IllegalStateException("The provider marked this roster stale. Refresh later; registration is disabled until a fresh roster is available.")
                            }
                            val rows = result.get("members")?.takeIf { it.isJsonArray }?.asJsonArray
                            roster = rows?.mapNotNull { it.takeIf { item -> item.isJsonObject }?.asJsonObject } ?: emptyList()
                            if (roster.isEmpty()) throw IllegalStateException("The provider returned no usable roster.")
                            registered = container.repository.allianceRegistrationStatus(roster.map { it.str("playerId") })
                            registrationAllowed = true
                        } catch (e: Exception) { error = e.message ?: "Roster could not be verified."; registrationAllowed = false }
                        finally { busy = false }
                    }
                },
                colors = CardDefaults.cardColors(containerColor = Panel),
                border = androidx.compose.foundation.BorderStroke(1.dp, Border),
                shape = RoundedCornerShape(16.dp)
            ) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("[${tag}] " + alliance.str("name"), color = Ink, fontWeight = FontWeight.Bold)
                        Text("Rank " + alliance.str("rank") + " · " + alliance.str("memberCount") + " members", color = Muted, fontSize = 11.sp)
                    }
                    Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = Mint)
                }
            }
        }
        if (selectedTag.isNotBlank()) {
            Divider(color = Border)
            Text("ROSTER · [${selectedTag}]", color = Mint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
            Text("${registered.size} already registered · ${(roster.size - registered.size).coerceAtLeast(0)} not registered", color = Muted, fontSize = 12.sp)
            roster.forEach { member ->
                val id = member.str("playerId")
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(member.str("name").ifBlank { "Kingshot Player" }, color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        Text(id, color = Muted, fontSize = 10.sp)
                    }
                    Text(if (id in registered) "REGISTERED" else "NOT REGISTERED",
                        color = if (id in registered) Mint else Warning, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                }
            }
            Button(
                onClick = {
                    scope.launch {
                        busy = true; error = null; notice = null
                        try {
                            val result = container.repository.registerAlliance(kingdom, selectedTag)
                            val count = result.get("validatedRosterCount")?.asInt ?: roster.size
                            notice = "Alliance registration confirmed for ${count} roster members. The existing server-side worker will process the initial sync and continue on its 24-hour schedule."
                            registrationAllowed = false
                        } catch (e: Exception) { error = e.message ?: "Alliance registration failed." }
                        finally { busy = false }
                    }
                },
                enabled = !busy && registrationAllowed,
                modifier = Modifier.fillMaxWidth()
            ) { Text(if (busy) "Registering…" else "Register alliance and schedule sync") }
            Text("The backend revalidates the roster and enforces the four-alliance kingdom cap and owner bypass. Existing registrations are preserved.", color = Muted, fontSize = 11.sp, lineHeight = 16.sp)
        }
        notice?.let { NoticeCard(it, Mint) }
        error?.let { NoticeCard(it, Danger) }
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back to Explore") }
    }
}


@Composable
private fun GiftCodesScreen(container: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    var codes by remember { mutableStateOf(emptyList<com.google.gson.JsonObject>()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var loadedAt by remember { mutableStateOf<String?>(null) }
    fun com.google.gson.JsonObject.str(key: String): String =
        get(key)?.takeIf { it.isJsonPrimitive && !it.isJsonNull }?.asString.orEmpty()
    suspend fun refresh() {
        busy = true; error = null
        try {
            val result = container.repository.giftCodes()
            val rows = result.get("codes")?.takeIf { it.isJsonArray }?.asJsonArray
            codes = rows?.mapNotNull { it.takeIf { item -> item.isJsonObject }?.asJsonObject } ?: emptyList()
            loadedAt = result.str("generatedAt")
        } catch (e: Exception) { error = e.message ?: "Could not load verified gift codes." }
        finally { busy = false }
    }
    LaunchedEffect(Unit) { refresh() }
    ScreenColumn {
        ScreenHeading("Verified gift codes", "Codes confirmed by the service. Only active, unsuppressed and verified entries are shown.")
        OutlinedButton(onClick = { scope.launch { refresh() } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Outlined.Refresh, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(if (busy) "Refreshing…" else "Refresh codes")
        }
        Text("${codes.size} verified codes · recent success counts cover the last 7 days", color = Muted, fontSize = 11.sp)
        codes.forEach { item ->
            val code = item.str("code")
            Card(colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, Border), shape = RoundedCornerShape(16.dp)) {
                Column(Modifier.fillMaxWidth().padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(code, color = Ink, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        IconButton(onClick = {
                            val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Kingshot gift code", code))
                        }) { Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy gift code", tint = Mint) }
                    }
                    Text(item.str("recentSuccesses") + " successful redemptions in the last 7 days", color = Muted, fontSize = 11.sp)
                    Text("Validated " + item.str("validatedAt").ifBlank { "date unavailable" }, color = Muted, fontSize = 10.sp)
                }
            }
        }
        if (codes.isEmpty() && !busy && error == null) NoticeCard("No currently verified gift codes were returned.", Warning)
        error?.let { NoticeCard(it, Danger) }
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back to Explore") }
    }
}

@Composable
private fun InfoScreen(onBack: () -> Unit) {
    ScreenColumn {
        ScreenHeading("Service information", "How the official Kingshot Auto Redeemer works.")
        Card(colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, Border), shape = RoundedCornerShape(18.dp)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Automatic redemption", color = Ink, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Text("Register a player once. The existing server-side workers check eligible gift codes on their scheduled cycle. The Android app does not run a competing worker.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
            }
        }
        Card(colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, Border), shape = RoundedCornerShape(18.dp)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Manual redemption", color = Ink, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Text("Manual requests use the public rate-limited service. If the game response is uncertain, the backend recovery journal blocks another attempt until the outcome can be reviewed.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
            }
        }
        Card(colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, Border), shape = RoundedCornerShape(18.dp)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Accounts and permissions", color = Ink, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Text("Discord sign-in verifies your account with the production backend. Developer and administrator permissions are never granted by the app itself.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
            }
        }
        Text("Independent community service. Not affiliated with Century Games.", color = Muted, fontSize = 10.sp)
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back to Explore") }
    }
}

@Composable
private fun NativeFeatureScreen(route: String, onBack: () -> Unit) {
    val title = when (route) {
        "/alliance-registration" -> "Alliance registration"
        "/gift-codes" -> "Gift codes"
        "/info" -> "Service information"
        "/profile" -> "Account profile"
        "/developer" -> "Developer portal"
        "/dev" -> "Developer workspace"
        "/devsupport" -> "Developer support"
        "/push" -> "Notifications"
        "/message" -> "Custom message"
        "/admin/players" -> "Player administration"
        "/admin/alliance-sync" -> "Alliance sync"
        "/admin/maintenance" -> "Maintenance"
        else -> "Official tools"
    }
    ScreenColumn {
        ScreenHeading(title, "Native Android workspace")
        NoticeCard(
            "This feature is being implemented with native Android screens and direct backend calls. It is intentionally not loading the website inside the app. Core native screens for Home, manual redemption, player lookup, registration, account sign-in and optional developer tools remain available.",
            Warning
        )
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Outlined.ArrowBack, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Back to Explore")
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
    var retryWaitSeconds by remember { mutableIntStateOf(0) }

    LaunchedEffect(retryWaitSeconds) {
        if (retryWaitSeconds > 0) {
            delay(1_000)
            retryWaitSeconds -= 1
        }
    }

    ScreenColumn {
        ScreenHeading("Manual redemption", "Submit a gift code through the official rate-limited redemption service. No Developer API key is required.")
        if (pending != null) {
            NoticeCard(
                "An earlier attempt is unresolved. The app has preserved its exact unresolved request. The backend blocks duplicate submissions while its outcome is unresolved. Only retry this same attempt.",
                Warning
            )
            Text("Request reference: " + pending!!.requestId.take(8) + "…", color = Muted, fontSize = 11.sp)
        }
        OutlinedField("Player ID", playerId, { playerId = it.filter(Char::isDigit).take(20) }, enabled = pending == null, keyboardType = KeyboardType.Number)
        OutlinedField("Kingdom ID", kingdomId, { kingdomId = it.filter(Char::isDigit).take(10) }, enabled = pending == null, keyboardType = KeyboardType.Number)
        OutlinedField("Gift code", code, { code = it.uppercase().filter { ch -> ch.isLetterOrDigit() || ch == '_' || ch == '-' }.take(32) }, enabled = pending == null)
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
                        if (apiError?.retryHint == "do_not_retry" && pending != null) {
                            pending = pending!!.copy(outcomeNeedsReview = true)
                            container.repository.savePendingRedemption(pending!!)
                        }
                        val definitiveFailure = (apiError?.let { it.retryHint == "do_not_retry" && it.status in listOf(400, 401, 404, 415) } == true) ||
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
            enabled = !busy && retryWaitSeconds == 0 && pending?.outcomeNeedsReview != true &&
                (pending != null || (playerId.matches(Regex("\\d{5,20}")) &&
                    kingdomId.matches(Regex("\\d{1,10}")) &&
                    code.matches(Regex("[A-Za-z0-9_-]{6,32}")))),
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(15.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = Night)
        ) {
            Icon(Icons.Outlined.Redeem, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(
                when {
                    busy -> "Processing securely…"
                    pending?.outcomeNeedsReview == true -> "Outcome needs review"
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
        ScreenHeading("Players", "Look up player profiles and enroll accounts in the existing server-side workflow. No Developer API key is needed.")
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
                            message = "Player profile loaded from the public player service."
                        } catch (error: Exception) {
                            profile = null
                            message = error.message
                        } finally { busy = false }
                    }
                },
                enabled = !busy && playerId.matches(Regex("\\d{5,20}")),
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
        ScreenHeading("V4 redemption history", "Optional Developer API feature. Reading history never submits a redemption.")
        if (!hasDeveloperKey) {
            NoticeCard("A Developer API key with redemption-history access is required. You can add one from Explore → Optional Developer API.", Warning)
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
