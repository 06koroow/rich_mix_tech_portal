function pullRoomIOFromSpace(sheet, spaceName, store) {
  const venue = store.find('venues', spaceName);
  if (!venue || !venue.audio) return false;
  const a = venue.audio;
  sheet.homeRun = {
    name: spaceName + ' (' + (a.prefix || 'HR') + ')',
    type: 'Digital Stage Rack (' + (a.mixingDeskProtocol || 'Dante') + ')',
    location: 'Venue I/O',
    inputChannels: a.inputChannels || 32,
    outputChannels: a.outputChannels || 16,
    prefix: a.prefix || 'HR',
    notes: 'Pulled from ' + spaceName + ' venue config.'
  };
  if (Array.isArray(a.stageboxes) && a.stageboxes.length > 0) {
    sheet.stageboxes = a.stageboxes.map(sb => ({
      id: store.uid ? store.uid('sb') : 'sb-' + Math.random().toString(36).substr(2, 6),
      letter: sb.letter || 'A',
      name: sb.name || 'Stagebox',
      location: sb.location || 'Stage',
      capacity: parseInt(sb.analogIn || sb.sockets || 16, 10),
      channels: Array.from({ length: parseInt(sb.analogIn || sb.sockets || 16, 10) }, (_, i) => ({
        socket: i + 1,
        actId: 'act-house',
        instrument: '',
        mic: '',
        phantom: false,
        repatch: false,
        repatchTo: '',
        homeRunCh: i + 1
      }))
    }));
  }
  return true;
}
