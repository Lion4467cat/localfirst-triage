package com.localfirst.triage.data

/**
 * Minimal English pluralizer for the category chips and history rows.
 *
 * The labels are short product nouns ("AWS Key", "Email", "Address"), so a full inflection
 * library would be overkill - but naive `label + "s"` produces "Addresss", which is exactly the
 * kind of sloppiness that makes a security product feel unfinished.
 */
object Pluralize {
    private val UNCOUNTABLE = setOf("health info", "info")

    fun of(count: Int, singular: String): String {
        if (count == 1) return singular
        val label = singular.trim()
        if (label.isEmpty()) return count.toString()
        if (label.lowercase() in UNCOUNTABLE) return label
        val lower = label.lowercase()
        val plural = when {
            lower.endsWith("s") || lower.endsWith("x") || lower.endsWith("z") ||
                lower.endsWith("ch") || lower.endsWith("sh") -> "${label}es"
            lower.endsWith("y") && label.length >= 2 && label[label.length - 2].isConsonant() ->
                label.dropLast(1) + "ies"
            else -> "${label}s"
        }
        return plural
    }

    private fun Char.isConsonant(): Boolean = this in 'a'..'z' && this !in "aeiou"
}
