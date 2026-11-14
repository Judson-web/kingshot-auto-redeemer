package com.judson.kingshot.autoredeemer.features.legal

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private data class LegalSection(val heading: String, val body: String)

private val terms = listOf(
    LegalSection("Use only Player IDs and accounts you are authorized to use", "You must have permission to use every Player ID and account you submit. You are responsible for the information and codes you provide. Do not impersonate another person, submit someone else's information without permission, or use the service to harass others. The service does not need your Kingshot password; never send it to us."),
    LegalSection("Unofficial service and game-account risk", "This is an unofficial community service. It is not operated, sponsored or endorsed by Century Games or the Kingshot game team, and it does not control the game's rules or enforcement decisions. Automated or third-party-assisted redemption may be restricted by the publisher's current terms, policies or enforcement systems and may carry account-related risk. We cannot guarantee that using this service is permitted by the publisher or that an account will not be limited or otherwise affected. Review the game's applicable rules and use the service at your own discretion."),
    LegalSection("Gift codes and redemption outcomes", "Gift codes are controlled by the game service and may expire, be limited, be unavailable in a kingdom, or be rejected. We cannot guarantee that a code will work, that rewards will be granted, or that an automated or manual attempt will succeed. Auto Redeem processes eligible codes on a scheduled basis; timing and outcomes vary. For API integrations, inspect the returned redemption status and do not blindly retry an ambiguous timeout because the upstream result may be unknown."),
    LegalSection("Accounts, API keys and support", "You are responsible for protecting your sign-in methods and API keys. Store keys server-side, never in browser bundles, URLs, public issue reports or support messages. Revoke a key if it may have been exposed. Developer access to the profile dashboard and developer API requires at least one active API key; administrator access is assigned separately and is not self-service. A Discord sign-in alone does not grant developer permissions. The public header shows the profile shortcut only after developer or administrator access has been verified, while the navigation drawer may retain a link to the access information. These interface choices do not replace server-side authorization. Support is best-effort, is not guaranteed to be live, and may require enough information to verify a request. Use the registration-removal option within support chat for removal requests."),
    LegalSection("Fair use and security", "Do not bypass rate limits or access controls, rotate keys or addresses to evade restrictions, overload the service, probe protected systems, interfere with other users, attempt unauthorized access, or use the service for fraud, phishing, malware or other unlawful activity. Do not use internal scheduler or worker endpoints as a public API. We may rate-limit, restrict or suspend access when reasonably necessary to protect users, the service or connected systems."),
    LegalSection("Availability and third-party services", "The service is provided on a best-effort basis without a guaranteed uptime or support response time. Features, upstream providers, codes and data may change, fail, be interrupted or be discontinued. Third-party services are controlled by their respective operators and may apply their own terms. Results from a provider are not a promise that rewards were granted or that the game account will remain unaffected."),
    LegalSection("Liability and applicable rights", "To the extent permitted by applicable law, the operator is not responsible for upstream service failures, expired or rejected codes, data supplied by third parties, interrupted processing, or consequences arising from a user's unauthorized or prohibited use. Nothing in these terms excludes or limits rights or liability that cannot lawfully be excluded or limited. If you do not agree with the current terms, stop using the service."),
    LegalSection("Changes", "These terms may be updated as the service or its risks change. We will post the current version here and update the revision date; continued use does not remove any rights or protections that apply under law.")
)

private val privacy = listOf(
    LegalSection("Information used to provide the service", "Depending on the features you use, we process the Kingshot Player ID and kingdom ID you submit; profile details returned by player-data providers; display information you choose to supply; gift codes submitted for redemption; registration status; redemption results and recovery records; and messages or photographs you send through support. When you use an account or developer features, we also process provider identity and account/session data needed to authenticate you, display your profile, and manage API keys. Do not send game passwords, payment information, authentication codes, or other secrets through the site."),
    LegalSection("Website telemetry and connection information", "When a page view is recorded, the service may store the request IP address when available, country, region, city and timezone supplied by the hosting platform, page path without query parameters, referrer hostname, user-agent string, inferred browser/operating-system/device category, accepted language, approximate screen-size class, and event timestamp. Visitor-event rows have a 30-day expiry and a scheduled daily job deletes expired rows. Collection is best-effort and rate-limited and runs at most once per page path per tab session. It does not intentionally record form values, game credentials, precise GPS coordinates, or a cross-site advertising fingerprint. Hosting providers may separately process request metadata under their own settings and policies."),
    LegalSection("Developer API and abuse-prevention records", "Developer API keys are shown in full only when created. The application stores a SHA-256 hash of each key, a short key prefix, its label, and lifecycle timestamps such as creation, last use and revocation. To enforce key-issuance and request limits, it also stores SHA-256 hashes derived from client IP addresses. These are pseudonymous identifiers, not guaranteed-anonymous data. The current database schema records a lifetime issuance cap of two keys per IP and has no automatic expiry configured for those issuance hashes or per-IP rate-limit rows. Revoking a key disables it but does not erase its audit, issuance or quota records."),
    LegalSection("Profile access and account roles", "The profile dashboard is available to signed-in users. Administrator tools are available only to the configured administrator account. The same Discord account can be used for Profile, Developer API, and Alliance Registration; API keys are needed only for API integrations. Role and access checks are enforced by server-side endpoints, and hiding a link is not used as an access-control mechanism."),
    LegalSection("Support messages, attachments and registration removal", "Support conversations and messages are stored so you and the support team can read the conversation and reply. Some support flows allow a photograph attachment; those files are stored in private Supabase Storage rather than a public image bucket. A Player ID may be optional in general support messages but can be needed to process an Auto Redeem removal request. Use the registration-removal option within support chat. It is a request workflow, not an instant purge of every related record or backup."),
    LegalSection("Notifications and browser storage", "If you enable web push, the service stores the subscription endpoint and subscription key material needed to deliver notifications. You can revoke notification permission or unsubscribe through your browser/device controls. Optional announcement images must already be hosted at a publicly accessible HTTPS URL; the service validates and references the URL but does not upload the image itself. The site also uses browser storage for service-worker/PWA behavior and small interface preferences."),
    LegalSection("Service providers and data sharing", "Information is sent to service providers when needed for a feature you use. Cloudflare Workers hosts the website assets and application API and may process request connection/location metadata. Supabase provides the application database, authentication and private file storage. Neon PostgreSQL holds an independent redemption-recovery journal; it is not the authoritative player registry. MightPulse supplies player-profile lookups. When a redemption is submitted, the Kingshot gift-code service operated by Century Games receives the Player ID, kingdom ID and gift code needed to process the request; this service does not ask for or send your Kingshot password. Discord and GitHub may process identity information when you use their respective sign-in options. Private archive and recovery operations may use GitHub or configured storage providers; recovery snapshots are intended to contain minimal registration state and are encrypted before off-site storage. Browser vendors and push delivery services process notification subscriptions and deliveries. These providers have their own policies, logs and retention practices."),
    LegalSection("Retention, removal and deletion requests", "Visitor-event rows have a 30-day expiry with a scheduled daily purge, though a scheduled job or infrastructure failure can delay deletion. We do not currently publish one fixed automatic-deletion period for player registrations, redemption history, support conversations/attachments, push subscriptions, developer key metadata or disaster-recovery material; these records are retained as needed for operation, security, support and recovery. IP-derived issuance/rate-limit hashes currently have no configured automatic expiry. Removing an Auto Redeem registration is intended to stop future scheduled processing, but does not necessarily remove redemption history, developer abuse-prevention records, support records, provider logs or previously created backups. Contact support to request access or deletion of information associated with your use. We may verify requests and retain limited information where reasonably needed for security, service integrity, dispute handling or applicable law. Copies held by independent providers are subject to their separate systems and retention policies."),
    LegalSection("Your choices and changes", "Account sign-in, developer API access and browser notifications are optional features. You can revoke an API key in the developer portal, sign out of an account and manage push permission through your browser/device. This notice may be updated when service features or data practices change; the date above identifies the latest revision. Questions and privacy requests can be sent through the site's support chat.")
)

@Composable
fun NativeLegalScreen(showPrivacy: Boolean, onBack: () -> Unit) {
    val sections = if (showPrivacy) privacy else terms
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text(if (showPrivacy) "Your data, explained." else "Use the service responsibly.",
            style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold,
            color = MaterialTheme.colorScheme.onBackground)
        Text(if (showPrivacy) "PRIVACY NOTICE" else "TERMS OF USE",
            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Bold)
        Text("Updated October 28, 2026 · Independent community project",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        sections.forEachIndexed { index, section ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("%02d  %s".format(index + 1, section.heading),
                        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(section.body, style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Text("This page describes current service practices and rules in plain language. It is not legal advice. Applicable rights and obligations depend on the circumstances and the laws that apply to you.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back to Explore") }
    }
}
