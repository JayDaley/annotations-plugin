"""
IETF Annotation Test Server — Flask application factory and entry point.
"""
from __future__ import annotations

import os
from flask import Flask
from models import db


def create_app(config: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=False)

    # ------------------------------------------------------------------ config
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(base_dir, 'annotations.db')}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["BASE_URL"] = os.environ.get("BASE_URL", "http://localhost:5000")
    app.config["DRAFTS_DIR"] = os.path.join(base_dir, "drafts")

    if config:
        app.config.update(config)

    # ----------------------------------------------------------- extensions
    db.init_app(app)

    # ------------------------------------------------------------ blueprints
    from auth import auth_bp
    from oauth import oauth_bp
    from annotations import annotations_bp
    from documents import documents_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(oauth_bp)
    app.register_blueprint(annotations_bp)
    app.register_blueprint(documents_bp)

    # --------------------------------------------------- create tables + seed
    with app.app_context():
        db.create_all()
        _auto_seed(app)

    return app


def _auto_seed(app: Flask) -> None:
    from models import User
    from seed import seed_all

    if User.query.count() == 0:
        seed_all(app)
        app.logger.info("Seed data created.")
    else:
        app.logger.info("Database already populated — skipping seed.")


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="IETF Annotation Test Server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    application = create_app()

    print(f"\n  IETF Annotation Test Server")
    print(f"  Running on http://{args.host}:{args.port}")
    print(f"  Press Ctrl+C to stop.\n")

    application.run(host=args.host, port=args.port, debug=args.debug)
