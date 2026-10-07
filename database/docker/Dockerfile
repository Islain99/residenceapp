# Image PostgreSQL 16 officielle + pgBackRest
FROM postgres:16

RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest /etc/pgbackrest \
 && chown -R postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest

COPY config/postgresql.conf  /etc/postgresql/postgresql.conf
COPY config/pgbackrest.conf  /etc/pgbackrest/pgbackrest.conf
COPY docker/node-entrypoint.sh /usr/local/bin/node-entrypoint.sh
# Scripts d'initialisation, migrations et données fictives intégrés à l'image
# (exécutés seulement à la création d'un principal vide)
COPY init/        /docker-entrypoint-initdb.d/
COPY migrations/  /migrations/
COPY seed/        /seed/
RUN chmod 755 /usr/local/bin/node-entrypoint.sh /docker-entrypoint-initdb.d/*.sh \
 && chmod 644 /etc/pgbackrest/pgbackrest.conf

ENTRYPOINT ["node-entrypoint.sh"]
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
