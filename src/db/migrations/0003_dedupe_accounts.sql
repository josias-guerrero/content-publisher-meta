UPDATE `posts`
SET `account_id` = (
  SELECT `keeper`.`id` FROM `accounts` `keeper`
  WHERE `keeper`.`platform` = (SELECT `src`.`platform` FROM `accounts` `src` WHERE `src`.`id` = `posts`.`account_id`)
    AND `keeper`.`external_id` = (SELECT `src`.`external_id` FROM `accounts` `src` WHERE `src`.`id` = `posts`.`account_id`)
  ORDER BY `keeper`.`created_at` DESC, `keeper`.`rowid` DESC
  LIMIT 1
)
WHERE `account_id` IN (
  SELECT `dup`.`id` FROM `accounts` `dup`
  WHERE EXISTS (
    SELECT 1 FROM `accounts` `newer`
    WHERE `newer`.`platform` = `dup`.`platform`
      AND `newer`.`external_id` = `dup`.`external_id`
      AND (`newer`.`created_at` > `dup`.`created_at` OR (`newer`.`created_at` = `dup`.`created_at` AND `newer`.`rowid` > `dup`.`rowid`))
  )
);
--> statement-breakpoint
DELETE FROM `accounts`
WHERE EXISTS (
  SELECT 1 FROM `accounts` AS `newer`
  WHERE `newer`.`platform` = `accounts`.`platform`
    AND `newer`.`external_id` = `accounts`.`external_id`
    AND (`newer`.`created_at` > `accounts`.`created_at` OR (`newer`.`created_at` = `accounts`.`created_at` AND `newer`.`rowid` > `accounts`.`rowid`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_platform_external_id_unique` ON `accounts` (`platform`,`external_id`);
