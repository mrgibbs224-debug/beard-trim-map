package com.beardtrimmap.app

/**
 * CORE-CAM1-B0.1 — the normalized camera-capability snapshot handed to the JS layer.
 *
 * A pure `Map<String, Any?>` builder (no `org.json`, no Android imports) so it is
 * unit-testable without a device or Robolectric. The bridge wraps the returned map in a
 * `JSONObject` for transport.
 *
 * The snapshot deliberately carries ONLY product-capability answers:
 *   selfAvailable / assistedAvailable / selfLighting / assistedLighting /
 *   assistedZoom{ hardwareSupported, runtimeAllowed, runtimeAllowedMin?, runtimeAllowedMax? } /
 *   exclusions / apiLevel / censusError?
 * It NEVER contains camera IDs, `CameraCharacteristics` internals, physical-lens trivia, or
 * vendor / model strings. `null` values are OMITTED (not emitted as JSON null) so the map maps
 * cleanly onto `JSONObject(map)`.
 */
object CameraRoleAvailabilitySnapshot {

    const val CONTRACT_VERSION = 1

    /** Build the snapshot for a successfully resolved [CameraRoleAvailability]. */
    fun of(
        availability: CameraRoleAvailability,
        apiLevel: Int?,
        censusError: String?
    ): Map<String, Any?> {
        val zoom = LinkedHashMap<String, Any?>()
        zoom["hardwareSupported"] = availability.assistedZoom.hardwareSupported
        zoom["runtimeAllowed"] = availability.assistedZoom.runtimeAllowed
        availability.assistedZoom.runtimeAllowedMin?.let { zoom["runtimeAllowedMin"] = it }
        availability.assistedZoom.runtimeAllowedMax?.let { zoom["runtimeAllowedMax"] = it }

        val m = LinkedHashMap<String, Any?>()
        m["contractVersion"] = CONTRACT_VERSION
        m["nativeAuthority"] = true
        m["selfAvailable"] = availability.selfAvailable
        m["assistedAvailable"] = availability.assistedAvailable
        m["selfLighting"] = availability.selfLighting.name
        m["assistedLighting"] = availability.assistedLighting.name
        m["assistedZoom"] = zoom
        m["exclusions"] = availability.exclusions
        apiLevel?.let { m["apiLevel"] = it }
        censusError?.let { m["censusError"] = it }
        return m
    }

    /**
     * Build the fail-closed snapshot when the capability authority itself could not run
     * (census threw, `CameraManager` unavailable, resolver could not identify a usable lens).
     * Both roles are unavailable — the caller must NOT fall back to assuming front + rear exist.
     */
    fun failed(reason: String): Map<String, Any?> {
        val zoom = LinkedHashMap<String, Any?>()
        zoom["hardwareSupported"] = false
        zoom["runtimeAllowed"] = false

        val m = LinkedHashMap<String, Any?>()
        m["contractVersion"] = CONTRACT_VERSION
        m["nativeAuthority"] = true
        m["selfAvailable"] = false
        m["assistedAvailable"] = false
        m["selfLighting"] = RoleLighting.NONE.name
        m["assistedLighting"] = RoleLighting.NONE.name
        m["assistedZoom"] = zoom
        m["exclusions"] = listOf("camera capability authority failed: $reason")
        m["censusError"] = reason
        return m
    }
}
