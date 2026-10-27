class_name ParallelNode
extends BTNode

func _on_tick(bb: Blackboard) -> Status:
	var policy: String = parameters.get("policy", "fail_on_one")
	var success_count := 0
	var fail_count := 0
	for child in children:
		var status = child.tick(bb)
		match status:
			Status.SUCCESS: success_count += 1
			Status.FAILURE: fail_count += 1
			Status.RUNNING: pass
	if policy == "fail_on_one" and fail_count > 0:
		return Status.FAILURE
	if success_count == children.size():
		return Status.SUCCESS
	return Status.RUNNING
