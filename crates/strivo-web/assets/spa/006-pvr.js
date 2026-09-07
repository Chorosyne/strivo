  chatSend: (room, text) =>
    API._fetch(`/chat/send`, {
      method: "POST",
      body: { room, text },
    }),
  chatRooms: () => API._fetch("/plugins/chat/rooms"),
