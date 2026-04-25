"""Entry point — starts the JSON-RPC server on stdin/stdout."""
import os
from typing import Any, Callable, Optional
from khutbah_pipeline.rpc import RpcServer, register
from khutbah_pipeline.align.crosscorr import align_files
from khutbah_pipeline.ingest.local import probe_local
from khutbah_pipeline.ingest.youtube import info_only, download
from khutbah_pipeline.edit.proxy import generate_proxy
from khutbah_pipeline.edit.waveform import compute_waveform
from khutbah_pipeline.edit.mux import apply_offset_and_mux
from khutbah_pipeline.edit.smartcut import smart_cut
from khutbah_pipeline.edit.thumbnail import extract_candidates
from khutbah_pipeline.detect.pipeline import run_detection_pipeline
from khutbah_pipeline.upload.youtube_api import upload_video, set_thumbnail, update_metadata
from khutbah_pipeline.upload.playlists import (
    list_playlists,
    create_playlist,
    add_video_to_playlist,
    resolve_or_create_playlist,
)

@register("ping")
def ping() -> dict[str, object]:
    return {"ok": True, "version": __import__("khutbah_pipeline").__version__}

@register("align.dual_file")
def _align(video_path: str, audio_path: str) -> dict[str, Any]:
    return align_files(video_path, audio_path)

@register("ingest.probe_local")
def _probe(path: str) -> dict[str, Any]:
    return probe_local(path)

@register("edit.apply_offset_mux")
def _mux(video_path: str, audio_path: str, offset_seconds: float, dst: str) -> dict[str, str]:
    apply_offset_and_mux(video_path, audio_path, offset_seconds, dst)
    return {"path": dst}

@register("edit.waveform")
def _waveform(src: str, peaks_count: int = 1500) -> dict[str, Any]:
    return compute_waveform(src, peaks_count=peaks_count)


@register("edit.generate_proxy")
def _proxy(
    src: str,
    dst: str,
    notify: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, str]:
    generate_proxy(src, dst, progress_cb=notify)
    return {"path": dst}

@register("edit.smart_cut")
def _smart_cut(
    src: str,
    dst: str,
    start: float,
    end: float,
    normalize_audio: bool = True,
    target_lufs: float = -14.0,
    target_tp: float = -1.0,
    target_lra: float = 11.0,
) -> dict[str, str]:
    smart_cut(
        src, dst, start, end,
        normalize_audio=normalize_audio,
        target_lufs=target_lufs,
        target_tp=target_tp,
        target_lra=target_lra,
    )
    return {"output": dst}


@register("edit.thumbnails")
def _thumbs(src: str, output_dir: str, count: int = 6) -> dict[str, list[str]]:
    return {"paths": extract_candidates(src, output_dir, count)}

@register("ingest.youtube_info")
def _yt_info(url: str) -> dict[str, Any]:
    return info_only(url)


@register("ingest.youtube_download")
def _yt_dl(
    url: str,
    output_dir: str,
    notify: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, str]:
    def cb(payload: dict[str, Any]) -> None:
        if notify:
            notify(payload)
    return {"path": download(url, output_dir, progress_cb=cb)}


@register("detect.run")
def _detect(
    audio_path: str,
    model_dir: str = "",
    notify: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Run the khutbah detection pipeline.

    `model_dir` defaults to:
    1. KHUTBAH_MODEL_DIR env override (used by Electron main to pass the
       packaged path — set in electron/sidecar/manager.ts at Phase 5)
    2. ../resources/models/whisper-large-v3 relative to cwd (dev path)

    The packaged app bundles the model at <resourcesPath>/models/whisper-large-v3/
    (see electron-builder.json extraResources). Electron main will set
    KHUTBAH_MODEL_DIR to that resolved path before spawning the sidecar.
    """
    if not model_dir:
        model_dir = os.environ.get(
            "KHUTBAH_MODEL_DIR",
            "../resources/models/whisper-large-v3",
        )
    return run_detection_pipeline(
        audio_path,
        model_dir,
        progress_cb=(lambda payload: notify(payload)) if notify else None,
    )

@register("upload.video")
def _upload(
    access_token: str,
    file_path: str,
    title: str,
    description: str,
    tags: list[str],
    category_id: str = "27",
    privacy_status: str = "unlisted",
    self_declared_made_for_kids: bool = False,
    default_audio_language: str = "ar",
) -> dict[str, Any]:
    return upload_video(
        access_token, file_path, title, description, tags,
        category_id, privacy_status, self_declared_made_for_kids, default_audio_language,
    )


@register("upload.thumbnail")
def _thumb(access_token: str, video_id: str, thumbnail_path: str) -> dict[str, Any]:
    return set_thumbnail(access_token, video_id, thumbnail_path)


@register("upload.update_metadata")
def _update(
    access_token: str,
    video_id: str,
    snippet: Optional[dict[str, Any]] = None,
    status: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return update_metadata(access_token, video_id, snippet, status)


@register("playlists.list")
def _list_playlists(access_token: str) -> list[dict[str, Any]]:
    return list_playlists(access_token)


@register("playlists.create")
def _create_playlist(
    access_token: str,
    title: str,
    description: str = "",
    privacy: str = "unlisted",
) -> dict[str, Any]:
    return create_playlist(access_token, title, description, privacy)


@register("playlists.add_video")
def _add_video(access_token: str, playlist_id: str, video_id: str) -> dict[str, Any]:
    return add_video_to_playlist(access_token, playlist_id, video_id)


@register("playlists.resolve_or_create")
def _resolve(
    access_token: str,
    name_or_id: Optional[str],
    auto_create: bool = True,
    visibility: str = "unlisted",
) -> dict[str, Optional[str]]:
    return {"playlist_id": resolve_or_create_playlist(access_token, name_or_id, auto_create, visibility)}


if __name__ == "__main__":
    RpcServer().run_forever()
