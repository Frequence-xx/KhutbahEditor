from pathlib import Path
import os
from khutbah_pipeline.edit.proxy import generate_proxy

FIXTURE = Path(__file__).parent / "fixtures" / "short_khutbah.mp4"


def test_proxy_generates_smaller_file(tmp_path):
    out = tmp_path / "proxy.mp4"
    generate_proxy(str(FIXTURE), str(out))
    assert out.exists()
    # Proxy must be smaller than source for our scaling target
    assert os.path.getsize(out) <= os.path.getsize(FIXTURE)
