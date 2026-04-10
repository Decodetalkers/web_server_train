use ashpd::desktop::{
    PersistMode,
    screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType},
};

use gst::prelude::*;
use gstreamer as gst;
use gstreamer_app as gst_app;
use std::os::fd::{AsRawFd, OwnedFd};

async fn get_path() -> ashpd::Result<(u32, OwnedFd)> {
    let proxy = Screencast::new().await?;
    let session = proxy.create_session(Default::default()).await?;
    proxy
        .select_sources(
            &session,
            SelectSourcesOptions::default()
                .set_cursor_mode(CursorMode::Embedded)
                .set_sources(SourceType::Monitor | SourceType::Window | SourceType::Virtual)
                .set_multiple(false)
                .set_restore_token(None)
                .set_persist_mode(PersistMode::DoNot),
        )
        .await?;

    let response = proxy
        .start(&session, None, Default::default())
        .await?
        .response()?;

    let stream = response
        .streams()
        .first()
        .expect("No stream found or selected")
        .to_owned();
    let path = stream.pipe_wire_node_id();

    let fd = proxy
        .open_pipe_wire_remote(&session, Default::default())
        .await?;

    Ok((path, fd))
}

#[allow(unused)]
#[derive(Debug)]
pub struct Handle {
    bus: gst::Bus,
    source: gst::Bin,
    fd: OwnedFd,
}

impl Drop for Handle {
    fn drop(&mut self) {
        let _ = self.source.send_event(gst::event::Eos::new());
        let _ = self.source.set_state(gst::State::Null);
    }
}

pub struct Frame<'a> {
    width: [u8; 2],
    height: [u8; 2],
    data: &'a [u8],
}

impl<'a> Frame<'a> {
    pub fn to_data(&self) -> Vec<u8> {
        let [width_1, width_2] = self.width;
        let [height_1, height_2] = self.height;
        let mut data = vec![width_1, width_2, height_1, height_2];
        data.extend(self.data.iter());
        data
    }
}

pub async fn connect_pw<D>(mut callback: D) -> anyhow::Result<Handle>
where
    D: FnMut(Frame) + Send + 'static,
{
    let (path, fd) = get_path().await?;
    gst::init()?;

    let source = gst::Pipeline::new();
    let pipewiresrc = gst::ElementFactory::make("pipewiresrc")
        .property("fd", fd.as_raw_fd())
        .property("path", path.to_string())
        .build()?;

    let videoconvert = gst::ElementFactory::make("videoconvert").build()?;

    let app_sink_caps = gst::Caps::builder("video/x-raw")
        .field("format", "NV12")
        .field("pixel-aspect-ratio", gst::Fraction::new(1, 1))
        .build();

    let app_sink: gst_app::AppSink = gst_app::AppSink::builder()
        .name("app_sink")
        .caps(&app_sink_caps)
        .build();

    app_sink.set_callbacks(
        gst_app::AppSinkCallbacks::builder()
            .new_sample(move |sink| {
                let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                let buffer = sample.buffer().ok_or(gst::FlowError::Error)?;
                let map = buffer.map_readable().map_err(|_| gst::FlowError::Error)?;

                let caps = sample.caps().ok_or(gst::FlowError::Error)?;
                let s = caps.structure(0).ok_or(gst::FlowError::Error)?;

                let width = s.get::<i32>("width").map_err(|_| gst::FlowError::Error)?;
                let height = s.get::<i32>("height").map_err(|_| gst::FlowError::Error)?;
                let width = width as i16;
                let height = height as i16;
                callback(Frame {
                    width: [(width >> 8) as u8, width as u8],
                    height: [(height >> 8) as u8, height as u8],
                    data: map.as_slice(),
                });

                Ok(gst::FlowSuccess::Ok)
            })
            .build(),
    );

    let app_sink: gst::Element = app_sink.clone().into();
    source.add_many([&pipewiresrc, &videoconvert, &app_sink])?;

    gst::Element::link_many([&pipewiresrc, &videoconvert, &app_sink])?;

    source.set_state(gst::State::Playing)?;

    Ok(Handle {
        bus: source.bus().unwrap(),
        source: source.into(),
        fd,
    })
}
