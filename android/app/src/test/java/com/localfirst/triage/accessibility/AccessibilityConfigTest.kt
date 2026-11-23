package com.localfirst.triage.accessibility

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The service can only react to accessibility events it asked the framework to deliver. When the
 * manifest config and the `when` in `onAccessibilityEvent` drift apart the handler silently never
 * runs, which is how the modal once survived an app switch and kept labelling the previous app.
 */
class AccessibilityConfigTest {

    private fun configFile(): File {
        val candidates = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .map { File(it, "src/main/res/xml/cordon_accessibility_config.xml") }
            .toList()
        return candidates.firstOrNull { it.isFile }
            ?: error("cordon_accessibility_config.xml not found from ${System.getProperty("user.dir")}")
    }

    private fun declaredTypes(): List<String> {
        val xml = configFile().readText()
        val attr = Regex("""android:accessibilityEventTypes="([^"]+)"""")
            .find(xml)?.groupValues?.get(1) ?: error("accessibilityEventTypes missing")
        return attr.split('|').map { it.trim() }.filter { it.isNotEmpty() }
    }

    @Test
    fun `window state changes are requested so a modal cannot outlive its app`() {
        assertTrue(
            "typeWindowStateChanged must be requested or handleWindowStateChanged never runs",
            declaredTypes().contains("typeWindowStateChanged"),
        )
    }

    @Test
    fun `every event type the service handles is requested in the config`() {
        val source = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .map { File(it, "src/main/java/com/localfirst/triage/accessibility/CordonAccessibilityService.kt") }
            .firstOrNull { it.isFile }
            ?: error("CordonAccessibilityService.kt not found")

        val handled = Regex("""AccessibilityEvent\.TYPE_([A-Z_]+)""")
            .findAll(source.readText())
            .map { it.groupValues[1] }
            .map { "type" + it.split('_').joinToString("") { part -> part.lowercase().replaceFirstChar(Char::uppercase) } }
            .toSet()

        val declared = declaredTypes().toSet()
        val missing = handled - declared
        assertTrue("handled but not requested: $missing", missing.isEmpty())
    }
}
