class_name SelectorNode
extends BTNode

func _on_tick(bb: Blackboard) -> Status:
	for child in children:
		var status = child.tick(bb)
		if status != Status.FAILURE:
			return status
	return Status.FAILURE
