package br.com.delupo.pttcoletor

import org.json.JSONObject

data class UserInfo(val id: String, val name: String)

sealed class ServerEvent {
    data class Welcome(val clientId: String, val channels: List<String>) : ServerEvent()
    data class ChannelState(val channel: String, val users: List<UserInfo>, val speaker: String?) : ServerEvent()
    data object PttGranted : ServerEvent()
    data class PttDenied(val reason: String) : ServerEvent()
    data class SpeakerStarted(val speakerId: String, val speakerName: String) : ServerEvent()
    data object SpeakerStopped : ServerEvent()
    data class ServerError(val message: String) : ServerEvent()
    data class ChannelsUpdated(val channels: List<String>) : ServerEvent()
    data class ChannelRemoved(val channel: String) : ServerEvent()
    data class CallStarted(val peerId: String, val peerName: String) : ServerEvent()
    data class CallEnded(val reason: String) : ServerEvent()
    data class CallDenied(val reason: String) : ServerEvent()
}

fun parseServerEvent(json: String): ServerEvent? {
    val obj = JSONObject(json)
    return when (obj.optString("type")) {
        "welcome" -> {
            val channelsArr = obj.getJSONArray("channels")
            val channels = (0 until channelsArr.length()).map { channelsArr.getString(it) }
            ServerEvent.Welcome(obj.getString("clientId"), channels)
        }
        "channel_state" -> {
            val usersArr = obj.getJSONArray("users")
            val users = (0 until usersArr.length()).map {
                val u = usersArr.getJSONObject(it)
                UserInfo(u.getString("id"), u.getString("name"))
            }
            val speaker = if (obj.isNull("speaker")) null else obj.getString("speaker")
            ServerEvent.ChannelState(obj.getString("channel"), users, speaker)
        }
        "ptt_granted" -> ServerEvent.PttGranted
        "ptt_denied" -> ServerEvent.PttDenied(obj.getString("reason"))
        "speaker_started" -> ServerEvent.SpeakerStarted(obj.getString("speakerId"), obj.getString("speakerName"))
        "speaker_stopped" -> ServerEvent.SpeakerStopped
        "error" -> ServerEvent.ServerError(obj.getString("message"))
        "channels" -> {
            val channelsArr = obj.getJSONArray("channels")
            val channels = (0 until channelsArr.length()).map { channelsArr.getString(it) }
            ServerEvent.ChannelsUpdated(channels)
        }
        "channel_removed" -> ServerEvent.ChannelRemoved(obj.getString("channel"))
        "call_started" -> ServerEvent.CallStarted(obj.getString("peerId"), obj.getString("peerName"))
        "call_ended" -> ServerEvent.CallEnded(obj.getString("reason"))
        "call_denied" -> ServerEvent.CallDenied(obj.getString("reason"))
        else -> null
    }
}

fun helloMessage(username: String, password: String, name: String, deviceId: String): String =
    JSONObject()
        .put("type", "hello")
        .put("username", username)
        .put("password", password)
        .put("name", name)
        .put("deviceId", deviceId)
        .toString()

fun joinMessage(channel: String): String =
    JSONObject().put("type", "join").put("channel", channel).toString()

fun pttStartMessage(): String = JSONObject().put("type", "ptt_start").toString()

fun pttStopMessage(): String = JSONObject().put("type", "ptt_stop").toString()

fun callStartMessage(targetId: String): String =
    JSONObject().put("type", "call_start").put("targetId", targetId).toString()

fun callEndMessage(): String = JSONObject().put("type", "call_end").toString()
