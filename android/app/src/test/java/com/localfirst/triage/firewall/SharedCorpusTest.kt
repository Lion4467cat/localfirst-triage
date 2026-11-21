package com.localfirst.triage.firewall

import com.localfirst.triage.model.ProtectionLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SharedCorpusTest {
    private fun locateCorpusFile(): File {
        val candidates = listOf(
            File("tests/shared-firewall-corpus.json"),
            File("../tests/shared-firewall-corpus.json"),
            File("../../tests/shared-firewall-corpus.json"),
        )
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate tests/shared-firewall-corpus.json from ${File(".").absolutePath}")
    }

    // Minimal pure-Kotlin JSON parser so Android JVM unit tests don't hit android.jar org.json stubs
    private class MiniJsonParser(private val src: String) {
        private var pos = 0

        fun parse(): Any? {
            skipWs()
            if (pos >= src.length) return null
            return when (src[pos]) {
                '{' -> parseObj()
                '[' -> parseArr()
                '"' -> parseStr()
                't', 'f' -> parseBool()
                'n' -> { pos += 4; null }
                else -> parseNum()
            }
        }

        private fun skipWs() {
            while (pos < src.length && src[pos].isWhitespace()) pos++
        }

        private fun parseObj(): Map<String, Any?> {
            val map = LinkedHashMap<String, Any?>()
            pos++ // '{'
            skipWs()
            if (src[pos] == '}') { pos++; return map }
            while (pos < src.length) {
                skipWs()
                val k = parseStr()
                skipWs()
                pos++ // ':'
                val v = parse()
                map[k] = v
                skipWs()
                if (src[pos] == ',') { pos++; continue }
                if (src[pos] == '}') { pos++; break }
            }
            return map
        }

        private fun parseArr(): List<Any?> {
            val list = ArrayList<Any?>()
            pos++ // '['
            skipWs()
            if (src[pos] == ']') { pos++; return list }
            while (pos < src.length) {
                list.add(parse())
                skipWs()
                if (src[pos] == ',') { pos++; continue }
                if (src[pos] == ']') { pos++; break }
            }
            return list
        }

        private fun parseStr(): String {
            pos++ // '"'
            val sb = StringBuilder()
            while (pos < src.length) {
                val c = src[pos++]
                if (c == '"') return sb.toString()
                if (c == '\\' && pos < src.length) {
                    when (val esc = src[pos++]) {
                        'n' -> sb.append('\n')
                        'r' -> sb.append('\r')
                        't' -> sb.append('\t')
                        '"', '\\', '/' -> sb.append(esc)
                        else -> sb.append(esc)
                    }
                } else {
                    sb.append(c)
                }
            }
            return sb.toString()
        }

        private fun parseBool(): Boolean {
            return if (src.startsWith("true", pos)) { pos += 4; true } else { pos += 5; false }
        }

        private fun parseNum(): Double {
            val start = pos
            while (pos < src.length && (src[pos].isDigit() || src[pos] in ".-+eE")) pos++
            return src.substring(start, pos).toDouble()
        }
    }

    @Suppress("UNCHECKED_CAST")
    @Test
    fun `passes all shared adversarial firewall corpus cases across LOW, MEDIUM, and HIGH`() {
        val raw = locateCorpusFile().readText()
        val array = MiniJsonParser(raw).parse() as List<Map<String, Any?>>
        assertTrue(array.size >= 4)

        for (entry in array) {
            val id = entry["id"] as String
            val input = entry["input"] as String
            val levels = entry["levels"] as Map<String, Map<String, Any?>>

            for ((levelName, rule) in levels) {
                val level = ProtectionLevel.valueOf(levelName.uppercase())
                val (sanitized, spans) = LocalFirewallEngine.scrub(input, level)

                val forbidden = rule["mustNotContain"] as? List<String> ?: emptyList()
                for (token in forbidden) {
                    assertFalse(
                        "[$id @ $levelName] leaked '$token' in '$sanitized'",
                        sanitized.contains(token),
                    )
                }

                val preserved = rule["mustPreserve"] as? List<String> ?: emptyList()
                for (token in preserved) {
                    assertTrue(
                        "[$id @ $levelName] failed to preserve '$token' in '$sanitized'",
                        sanitized.contains(token),
                    )
                }

                if (rule["expectZeroMasks"] == true) {
                    assertEquals("[$id @ $levelName] expected 0 masks", 0, spans.size)
                }
            }
        }
    }
}
