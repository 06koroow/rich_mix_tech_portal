-- Venues & Spaces
CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    capacity VARCHAR(100),
    stage_dimensions VARCHAR(100),
    standard_inventory TEXT, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Permanent Audio Home Run (Trunk) per Venue
CREATE TABLE venue_audio_trunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
    input_channels INTEGER NOT NULL DEFAULT 48,
    output_channels INTEGER NOT NULL DEFAULT 24,
    prefix VARCHAR(10) DEFAULT 'HR'
);

-- Permanent Stageboxes per Venue
CREATE TABLE venue_stageboxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
    letter VARCHAR(5) NOT NULL,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    sockets INTEGER NOT NULL DEFAULT 16,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Permanent DMX Lighting Rig per Venue
CREATE TABLE venue_dmx_fixtures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
    fixture_id_num INTEGER NOT NULL,
    manufacturer_model VARCHAR(200),
    mode VARCHAR(50),
    channels INTEGER NOT NULL DEFAULT 1,
    universe INTEGER NOT NULL DEFAULT 1,
    address INTEGER NOT NULL,
    location VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
