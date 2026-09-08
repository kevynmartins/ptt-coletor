package br.com.delupo.pttcoletor

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class UsersAdapter(
    private var users: List<UserInfo> = emptyList(),
    private var speakerId: String? = null,
    private var myClientId: String? = null,
    private val onCallClick: (UserInfo) -> Unit = {}
) : RecyclerView.Adapter<UsersAdapter.ViewHolder>() {

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val avatar: TextView = view.findViewById(R.id.textAvatar)
        val name: TextView = view.findViewById(R.id.textName)
        val speakingIcon: ImageView = view.findViewById(R.id.iconSpeaking)
        val callButton: Button = view.findViewById(R.id.btnCallUser)
    }

    fun update(users: List<UserInfo>, speakerId: String?, myClientId: String?) {
        this.users = users
        this.speakerId = speakerId
        this.myClientId = myClientId
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_user, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val user = users[position]
        holder.avatar.text = user.name.trim().take(1).uppercase().ifEmpty { "?" }
        val isMe = user.id == myClientId
        holder.name.text = if (isMe) {
            "${user.name} (${holder.itemView.context.getString(R.string.label_you)})"
        } else {
            user.name
        }
        holder.speakingIcon.visibility = if (user.id == speakerId) View.VISIBLE else View.GONE
        holder.callButton.visibility = if (isMe) View.GONE else View.VISIBLE
        holder.callButton.setOnClickListener { onCallClick(user) }
    }

    override fun getItemCount(): Int = users.size
}
