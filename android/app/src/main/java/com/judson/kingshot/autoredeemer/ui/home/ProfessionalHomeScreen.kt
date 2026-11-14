package com.judson.kingshot.autoredeemer.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Redeem
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Canvas = Color(0xFF07110E)
private val SurfaceLow = Color(0xFF101C17)
private val SurfaceHigh = Color(0xFF172820)
private val Accent = Color(0xFFB8E6C8)
private val AccentDeep = Color(0xFF72C997)
private val TextPrimary = Color(0xFFF1F6F1)
private val TextSecondary = Color(0xFF9EADA4)
private val Outline = Color(0xFF293B32)

/**
 * Native product dashboard. Actions are wired to the app's existing destinations;
 * service health remains sourced from the production repository.
 */
@Composable
fun ProfessionalHomeScreen(
    healthText: String,
    serviceOnline: Boolean?,
    apiKeySet: Boolean,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onRedeem: () -> Unit,
    onPlayers: () -> Unit,
    onSettings: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Canvas, Color(0xFF0C1913), Canvas)))
            .padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("KINGSHOT  /  REDEEMER", color = AccentDeep, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.8.sp)
                Text("Command centre", color = TextPrimary, fontSize = 29.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.7).sp)
                Text("Your rewards and kingdom tools, in one place.", color = TextSecondary, fontSize = 13.sp)
            }
            Surface(shape = RoundedCornerShape(17.dp), color = SurfaceHigh) {
                Icon(Icons.Outlined.Shield, contentDescription = "Official app", tint = Accent, modifier = Modifier.padding(13.dp).size(25.dp))
            }
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(27.dp),
            colors = CardDefaults.cardColors(containerColor = SurfaceHigh),
            border = androidx.compose.foundation.BorderStroke(1.dp, Outline)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Brush.linearGradient(listOf(Color(0xFF1C382A), Color(0xFF14231C), Color(0xFF101B16))))
                    .padding(20.dp)
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(color = Color(0xFF254B36), shape = CircleShape) {
                            Row(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(7.dp)
                            ) {
                                Box(Modifier.size(7.dp).background(if (serviceOnline == true) AccentDeep else Color(0xFFE7B96E), CircleShape))
                                Text(
                                    when (serviceOnline) { true -> "SYSTEM OPERATIONAL"; false -> "SERVICE CHECK"; null -> "CONNECTING" },
                                    color = Accent,
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 0.9.sp
                                )
                            }
                        }
                        Spacer(Modifier.weight(1f))
                        Icon(Icons.Outlined.CloudDone, contentDescription = null, tint = Accent, modifier = Modifier.size(21.dp))
                    }
                    Text("Your kingdom.\nYour next reward.", color = TextPrimary, fontSize = 31.sp, lineHeight = 35.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.8).sp)
                    Text(
                        "Automatic redemption runs securely on the production service. Find a player or redeem a code whenever you're ready.",
                        color = Color(0xFFC1D0C6), fontSize = 13.sp, lineHeight = 19.sp
                    )
                    Button(
                        onClick = onRedeem,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(15.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF102018))
                    ) {
                        Icon(Icons.Outlined.Redeem, contentDescription = null)
                        Spacer(Modifier.width(9.dp))
                        Text("Redeem a gift code", fontWeight = FontWeight.Bold)
                        Spacer(Modifier.weight(1f))
                        Icon(Icons.Outlined.ArrowForward, contentDescription = null)
                    }
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(11.dp)) {
            StatusTile(
                modifier = Modifier.weight(1f),
                label = "AUTO REDEEM",
                value = "Server managed",
                detail = "No app-side executor",
                icon = Icons.Outlined.Bolt
            )
            StatusTile(
                modifier = Modifier.weight(1f),
                label = "DEVELOPER API",
                value = if (apiKeySet) "Configured" else "Optional",
                detail = if (apiKeySet) "Integration key saved" else "Not needed for users",
                icon = Icons.Outlined.Key
            )
        }

        Column(verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Your tools", color = TextPrimary, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                Text("QUICK ACCESS", color = TextSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                ActionTile(
                    modifier = Modifier.weight(1f),
                    title = "Player lookup",
                    subtitle = "Profiles & stats",
                    icon = Icons.Outlined.Groups,
                    onClick = onPlayers
                )
                ActionTile(
                    modifier = Modifier.weight(1f),
                    title = "App settings",
                    subtitle = "Preferences & API",
                    icon = Icons.Outlined.Key,
                    onClick = onSettings
                )
            }
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(21.dp),
            colors = CardDefaults.cardColors(containerColor = SurfaceLow),
            border = androidx.compose.foundation.BorderStroke(1.dp, Outline)
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Production connection", color = TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.weight(1f))
                    Text(if (serviceOnline == true) "LIVE" else "STATUS", color = AccentDeep, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                }
                Text(healthText, color = TextSecondary, fontSize = 12.sp, lineHeight = 17.sp)
                OutlinedButton(
                    onClick = onRefresh,
                    enabled = !refreshing,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(13.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Accent)
                ) {
                    Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (refreshing) "Checking service…" else "Refresh service status")
                }
            }
        }

        Text(
            "Connected to the official production backend  •  Your account permissions are verified server-side",
            color = TextSecondary,
            fontSize = 10.sp,
            lineHeight = 15.sp
        )
    }
}

@Composable
private fun StatusTile(
    modifier: Modifier,
    label: String,
    value: String,
    detail: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(19.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceLow),
        border = androidx.compose.foundation.BorderStroke(1.dp, Outline)
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Icon(icon, contentDescription = null, tint = AccentDeep, modifier = Modifier.size(19.dp))
            Text(label, color = TextSecondary, fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Text(value, color = TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Text(detail, color = TextSecondary, fontSize = 10.sp, lineHeight = 14.sp)
        }
    }
}

@Composable
private fun ActionTile(
    modifier: Modifier,
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(19.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceHigh),
        border = androidx.compose.foundation.BorderStroke(1.dp, Outline)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Surface(color = Color(0xFF244431), shape = RoundedCornerShape(12.dp)) {
                Icon(icon, contentDescription = null, tint = Accent, modifier = Modifier.padding(9.dp).size(20.dp))
            }
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                Text(subtitle, color = TextSecondary, fontSize = 10.sp)
            }
        }
    }
}
